/**
 * The WebdriverIO reporter.
 *
 * WebdriverIO constructs one instance PER WORKER (`new Reporter(options)` in
 * @wdio/runner), inside the process that runs the tests, and each spec file gets
 * its own worker. So every instance writes its own report file, and the files
 * are merged by `qf collect` -- which keeps only the NEWEST run it finds, by
 * `metadata.runId`. Workers that disagree on the runId therefore upload one
 * worker's results and report success; see `QualflareService`.
 *
 * WHEN A TEST STOPS OWNING WHAT HAPPENS
 *
 * A test's verdict (`onTestPass`/`onTestFail`) is not the end of its window:
 * `afterEach` hooks -- where screenshots-on-failure are usually taken -- can run
 * after it. So a finished test keeps receiving screenshots and `qualflare.*()`
 * calls until the next test starts, an "all" hook starts, or its suite ends.
 * Measured on WDIO 9: `afterTest` and its screenshot arrived BEFORE the verdict,
 * attributed to the right uid, which this also handles.
 *
 * NOTHING IS SWEPT HERE. Several workers write into one results directory at
 * once, so deleting "stale" files from a worker would delete its siblings'
 * reports. Only `QualflareService`, in the launcher, cleans.
 */
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as wdioReporterModule from '@wdio/reporter';
import type { AfterCommandArgs, HookStats, RunnerStats, TestStats } from '@wdio/reporter';

import { resolveCapabilities, type CapabilityInfo } from '../config/capabilities.js';
import { LauncherRunId } from '../config/launcher-id.js';
import { resolveDefaultExport } from '../interop.js';
import { resolveConfig, type QualflareWebdriverioOptions, type ResolvedReporterConfig } from '../config/resolve-config.js';
import { logger } from '../shared/logger.js';
import type { Attachment, CaseStatus } from '../shared/types.js';
import { beginTest, currentTestUid, endCurrentTest, takeMessages } from '../runtime/store.js';
import type { RuntimeMessage } from '../runtime/message-types.js';
import { AttachmentBudget } from './attachment-reader.js';
import { describeError, type RecordedAttempt } from './attempts.js';
import { buildCase, mapStatus } from './case-builder.js';
import { buildCollectPayload } from './collect-builder.js';
import { writeImageAttachment } from './image-writer.js';
import { groupIntoSuites, relativizeFile, type CaseWithFile } from './suite-builder.js';

/** WDIOReporter, whichever build of this package is running. A plain default
 * import is the class in the ESM build and the whole module object in the CJS
 * one -- see interop.ts. */
const WDIOReporter = resolveDefaultExport(wdioReporterModule) as typeof wdioReporterModule.default;

/** One test's identity, the same for each of its attempts. */
interface TestIdentity {
  id: string;
  name: string;
  file: string;
}

/** Everything recorded for one test across its attempts, keyed by its id. */
interface TestRecord extends TestIdentity {
  attempts: RecordedAttempt[];
  messages: RuntimeMessage[];
  screenshots: { attempt: number; attachment: Attachment }[];
}

/** A test whose verdict arrived but whose window is still open. */
interface Settling {
  uid: string;
  id: string;
  /** False for a retried attempt: metadata from a superseded attempt is
   * discarded, final-attempt-wins, as across the reporter family. */
  keepMessages: boolean;
}

/** How long the end of a worker waits for a Windows launcher lookup still in
 * flight: inside WebdriverIO's default 5s reporterSyncTimeout, with margin. */
const LAUNCHER_WAIT_MS = 4_000;

/** `"before all" hook`, `"after all" hook` (Mocha) and `beforeAll`/`afterAll`
 * (Jasmine) close the previous test's window; per-test hooks do not. */
const ALL_HOOK = /(before|after)[\s-]?all/i;

export class QualflareWebdriverioReporter extends WDIOReporter {
  private config: ResolvedReporterConfig;
  private readonly budget: AttachmentBudget;
  private session: CapabilityInfo = { key: 'unknown', properties: {} };
  /** The base spec paths are made relative to: WebdriverIO's own `rootDir`
   * (the config file's directory), falling back to the working directory. */
  private rootDir = process.cwd();
  /** Insertion-ordered, so the report lists tests in the order they ran. */
  private readonly records = new Map<string, TestRecord>();
  /** Tests that started and have no verdict yet, by uid. */
  private readonly live = new Map<string, TestIdentity & { startedAt?: Date }>();
  private settling: Settling | null = null;
  /** Only when nothing better than a random id was found: see launcher-id.ts. */
  private readonly launcherRunId: LauncherRunId | undefined;
  /** False while the report waits for a launcher lookup still in flight. */
  private synchronised = true;

  constructor(options: QualflareWebdriverioOptions & Record<string, unknown>) {
    super(options);
    this.config = resolveConfig(options);
    this.budget = new AttachmentBudget(this.config.maxTotalAttachmentBytes);
    // Started now rather than at the end: on Windows the lookup takes seconds,
    // and it can run for the whole of the worker's tests in the background.
    this.launcherRunId = this.config.runIdSource === 'random' ? LauncherRunId.start() : undefined;
    if (options.outputDir && !options.resultsDir) {
      logger.info(
        `"outputDir" is WebdriverIO's log directory, not this reporter's; reports go to ` +
          `"${this.config.outputDir}". Set "resultsDir" to change that.`,
      );
    }
  }

  override onRunnerStart(runner: RunnerStats): void {
    this.session = resolveCapabilities(runner.capabilities, runner.isMultiremote);
    const config = runner.config as { rootDir?: string; framework?: string; shard?: { current?: number; total?: number } } | undefined;
    if (typeof config?.rootDir === 'string' && config.rootDir !== '') {
      this.rootDir = config.rootDir;
    }
    // `--shard 2/3` is 1-based; shardIndex is 0-based.
    const shard = config?.shard;
    if (this.config.shardIndex === undefined && shard?.current && shard.total && shard.total > 1) {
      this.config = { ...this.config, shardIndex: shard.current - 1 };
    }
    if (config?.framework === 'cucumber') {
      logger.warn(
        'Cucumber is not supported yet: WebdriverIO reports its scenarios as suites and its steps as tests, ' +
          'so each Gherkin step would be reported as a separate test case.',
      );
    }
  }

  override onTestStart(test: TestStats): void {
    this.settle();
    this.live.set(test.uid, { ...this.identify(test), startedAt: test.start });
    beginTest(test.uid);
  }

  override onTestPass(test: TestStats): void {
    this.finishAttempt(test, 'passed', true);
  }

  override onTestFail(test: TestStats): void {
    this.finishAttempt(test, 'failed', true);
  }

  /** A failed attempt that will run again. No `onTestEnd` follows it. */
  override onTestRetry(test: TestStats): void {
    this.finishAttempt(test, 'failed', false);
  }

  override onTestSkip(test: TestStats): void {
    this.skip(test);
  }

  override onTestPending(test: TestStats): void {
    this.skip(test);
  }

  override onHookStart(hook: HookStats): void {
    if (ALL_HOOK.test(hook.title ?? '')) {
      this.settle();
    }
  }

  override onSuiteEnd(): void {
    this.settle();
  }

  override onAfterCommand(command: AfterCommandArgs): void {
    if (!this.config.enabled || !this.config.screenshots) {
      return;
    }
    const base64 = screenshotPayload(command);
    if (base64 === undefined) {
      return;
    }
    const uid = currentTestUid();
    const owner = uid === null ? undefined : this.ownerOf(uid);
    if (!owner) {
      // Taken in a before/after-all hook: there is no single test it belongs to.
      return;
    }
    const written = writeImageAttachment(
      Buffer.from(base64, 'base64'),
      'image/png',
      this.config.outputDir,
      this.config.maxAttachmentBytes,
    );
    if (!written) {
      return;
    }
    const record = this.recordFor(owner.identity);
    record.screenshots.push({
      // A screenshot taken while the test runs belongs to the attempt in
      // progress; one taken in afterEach, after the verdict, to the last one.
      attempt: owner.running ? record.attempts.length + 1 : record.attempts.length,
      attachment: {
        name: 'Screenshot',
        mimeType: written.mimeType,
        localImagePath: written.localImagePath,
        fileSize: written.fileSize,
      },
    });
  }

  override onRunnerEnd(): void {
    this.settle();
    // A test that started and never reached a verdict: the worker ended under it.
    for (const [uid, identity] of this.live) {
      this.recordFor(identity).attempts.push({
        status: 'error',
        message: 'The worker ended before this test finished.',
        ...(identity.startedAt ? { startedAt: identity.startedAt } : {}),
      });
      takeMessages(uid);
    }
    this.live.clear();
    endCurrentTest();

    const lookup = this.launcherRunId;
    if (!lookup || lookup.settled) {
      this.writeReport();
      return;
    }
    // A Windows lookup still in flight. WebdriverIO waits for a reporter whose
    // isSynchronised is false, for up to reporterSyncTimeout (5s by default),
    // so wait inside that budget, then fall back to a blocking lookup rather
    // than write the report under an id the other workers do not share.
    this.synchronised = false;
    const budget = new Promise<void>((resolve) => setTimeout(resolve, LAUNCHER_WAIT_MS).unref());
    void Promise.race([lookup.wait(), budget]).then(() => {
      lookup.valueSync();
      this.writeReport();
      this.synchronised = true;
    });
  }

  /** Read by @wdio/runner, which keeps the worker alive while this is false. */
  override get isSynchronised(): boolean {
    return this.synchronised;
  }

  /** Records one finished execution and opens its settling window. */
  private finishAttempt(test: TestStats, verdict: CaseStatus, isFinal: boolean): void {
    const identity = this.live.get(test.uid) ?? this.identify(test);
    this.live.delete(test.uid);
    const status = isFinal ? mapStatus(test.state ?? verdict) : 'failed';
    const failure = status === 'failed' ? describeError(test.error ?? test.errors?.[0]) : {};
    this.recordFor(identity).attempts.push({
      status,
      ...failure,
      ...(typeof test.duration === 'number' ? { durationMs: test.duration } : {}),
      ...(test.start ? { startedAt: test.start } : {}),
    });
    this.settle();
    this.settling = { uid: test.uid, id: identity.id, keepMessages: isFinal };
  }

  /** A test skipped without starting (`it.skip`, `xit`), or skipped from inside
   * its own body, which WebdriverIO reports after `onTestStart`. */
  private skip(test: TestStats): void {
    if (this.live.has(test.uid)) {
      this.finishAttempt(test, 'skipped', true);
      return;
    }
    this.settle();
    this.recordFor(this.identify(test)).attempts.push({ status: 'skipped' });
  }

  /** Closes the settling window: the messages recorded for that execution are
   * kept (final attempt) or discarded (retried attempt), and later
   * `qualflare.*()` calls are dropped until the next test starts. */
  private settle(): void {
    const settling = this.settling;
    if (!settling) {
      return;
    }
    this.settling = null;
    const messages = takeMessages(settling.uid);
    if (settling.keepMessages) {
      const record = this.records.get(settling.id);
      if (record) {
        record.messages = messages;
      }
    }
    // Only when the settled test is still the current one: settling the
    // PREVIOUS test from finishAttempt must not detach the test that just
    // finished, whose afterEach hooks are about to run.
    if (currentTestUid() === settling.uid) {
      endCurrentTest();
    }
  }

  /** Which test a uid's screenshot belongs to, and whether it is still running. */
  private ownerOf(uid: string): { identity: TestIdentity; running: boolean } | undefined {
    const live = this.live.get(uid);
    if (live) {
      return { identity: live, running: true };
    }
    if (this.settling?.uid === uid) {
      const record = this.records.get(this.settling.id);
      return record ? { identity: record, running: false } : undefined;
    }
    return undefined;
  }

  private recordFor(identity: TestIdentity): TestRecord {
    let record = this.records.get(identity.id);
    if (!record) {
      record = { ...identity, attempts: [], messages: [], screenshots: [] };
      this.records.set(identity.id, record);
    }
    return record;
  }

  /**
   * A test's identity from the suite stack WebdriverIO maintains.
   *
   * The name is the describe chain plus the title, joined with spaces as the
   * sibling reporters do. NOT `fullTitle`: WebdriverIO's Mocha adapter joins it
   * with dots ("Suite A.is flaky once"), which reads as a property path.
   *
   * The id adds the file and the capability. Without the capability, one suite
   * run on Chrome and Firefox -- or iOS and Android -- would merge two histories
   * into one, and the second result would overwrite the first in the launch.
   */
  private identify(test: TestStats): TestIdentity {
    const suites = this.currentSuites.slice(1);
    const titles = suites.map((s) => s.title).filter((t): t is string => Boolean(t));
    const name = [...titles, test.title].filter(Boolean).join(' ');
    const rawFile = suites[suites.length - 1]?.file ?? '';
    const file = rawFile ? relativizeFile(toPath(rawFile), this.rootDir) : '';
    return { id: `${file}#${name}@${this.session.key}`, name, file };
  }

  private writeReport(): void {
    if (!this.config.enabled) {
      return;
    }
    const launcherId = this.launcherRunId?.value();
    if (this.config.runIdSource === 'random' && launcherId) {
      this.config = { ...this.config, runId: launcherId, runIdSource: 'launcher' };
    }

    const cases: CaseWithFile[] = [];
    for (const record of this.records.values()) {
      cases.push({
        file: record.file,
        testCase: buildCase(
          {
            id: record.id,
            name: record.name,
            file: record.file,
            attempts: record.attempts,
            messages: record.messages,
            screenshots: nameScreenshots(record),
            capabilityProperties: this.session.properties,
          },
          this.config,
          this.budget,
        ),
      });
    }

    const suites = groupIntoSuites(cases, this.config.framework);
    if (suites.length === 0) {
      logger.info('no test results were captured by this worker — skipping file write.');
      return;
    }

    const collect = buildCollectPayload(suites, this.config, this.session);
    try {
      fs.mkdirSync(this.config.outputDir, { recursive: true });
      // A bare UUID, never a name containing "webdriver": when content detection
      // fails, qualflare-cli routes any *webdriver* filename to its Selenium parser.
      const target = path.join(this.config.outputDir, `${randomUUID()}.json`);
      // Synchronous on purpose: the worker may exit as soon as this returns.
      fs.writeFileSync(target, JSON.stringify(collect), 'utf8');
      logger.info(`wrote ${cases.length} case(s) to ${target}`);
    } catch (err) {
      logger.error(`could not write the report: ${(err as Error).message}`);
    }

    if (this.config.runIdSource === 'random') {
      logger.warn(
        'this worker could not identify its `wdio` launcher process and made up its own runId, so ' +
          '`qf collect` will upload only ONE worker\'s results. Add QualflareService to `services` in ' +
          'wdio.conf (or set QUALFLARE_RUN_ID) so every worker shares one. ' +
          'See https://github.com/Qualflare/qualflare-webdriverio#setup',
      );
    }
  }
}

/** The base64 image of a finished screenshot command, or undefined.
 *
 * Matches the WebDriver screenshot endpoints (page and element), whose result is
 * `{ value: <base64> }`. `saveScreenshot` is deliberately not matched: it is
 * built on `takeScreenshot`, which is reported separately, and matching both
 * would attach every such screenshot twice. */
function screenshotPayload(command: AfterCommandArgs): string | undefined {
  const endpoint = typeof command.endpoint === 'string' ? command.endpoint : '';
  const isScreenshot =
    command.command === 'takeScreenshot' ||
    command.command === 'takeElementScreenshot' ||
    /\/screenshot$/.test(endpoint);
  if (!isScreenshot) {
    return undefined;
  }
  const result = command.result as { value?: unknown } | undefined;
  const value = result?.value;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Numbers a test's screenshots, and says which attempt each came from when the
 * test ran more than once. */
function nameScreenshots(record: TestRecord): Attachment[] {
  const retried = record.attempts.length > 1;
  const several = record.screenshots.length > 1;
  return record.screenshots.map(({ attempt, attachment }, i) => {
    let name = several ? `Screenshot ${i + 1}` : 'Screenshot';
    if (retried) {
      name = `${name} (attempt ${attempt})`;
    }
    return { ...attachment, name };
  });
}

/** WebdriverIO 9 reports spec files as `file://` URLs; 8 as paths. */
function toPath(file: string): string {
  if (file.startsWith('file://')) {
    try {
      return fileURLToPath(file);
    } catch {
      return file;
    }
  }
  return file;
}

export default QualflareWebdriverioReporter;
