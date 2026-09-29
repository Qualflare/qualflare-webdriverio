import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QualflareWebdriverioReporter } from '../../src/reporter/reporter.js';
import { qualflare } from '../../src/runtime/qualflare-api.js';
import type { Collect } from '../../src/shared/types.js';

/**
 * Drives the reporter with the event stream @wdio/runner emits, in the order
 * measured on WDIO 9 (see the spike findings in the plan): a retried Mocha test
 * gets `test:retry` and NO `test:end`, and its next attempt a fresh uid.
 */

// A 1x1 transparent PNG.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

let dir: string;
let root: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-wdio-reporter-'));
  root = '/project';
  vi.stubEnv('QUALFLARE_RUN_ID', 'run-under-test');
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

function makeReporter(extra: Record<string, unknown> = {}): QualflareWebdriverioReporter {
  return new QualflareWebdriverioReporter({
    resultsDir: dir,
    branch: 'main',
    commit: 'abc',
    // WDIOReporter's constructor opens a log file unless handed a stream.
    writeStream: { write: () => true },
    ...extra,
  } as never);
}

const CHROME = { browserName: 'chrome', browserVersion: '140.0', platformName: 'linux' };

class Run {
  private n = 0;
  constructor(
    readonly reporter: QualflareWebdriverioReporter,
    readonly file = 'file:///project/test/specs/login.spec.js',
  ) {}

  start(capabilities: Record<string, unknown> = CHROME, isMultiremote = false): this {
    this.reporter.emit('runner:start', {
      cid: '0-0',
      specs: [this.file],
      capabilities,
      config: { rootDir: root, framework: 'mocha' },
      isMultiremote,
      sessionId: 's',
    });
    return this;
  }

  suite(title: string): this {
    this.reporter.emit('suite:start', { title, fullTitle: title, file: this.file, uid: `suite-${title}`, cid: '0-0', type: 'suite:start' });
    return this;
  }

  endSuite(title: string): this {
    this.reporter.emit('suite:end', { title, fullTitle: title, file: this.file, uid: `suite-${title}`, cid: '0-0', type: 'suite:end' });
    return this;
  }

  /** Starts a test and returns its uid. */
  test(title: string): string {
    const uid = `test-${this.n++}`;
    this.reporter.emit('test:start', { title, fullTitle: title, parent: '', uid, cid: '0-0', type: 'test:start', pending: false, specs: [] });
    return uid;
  }

  pass(uid: string, title: string): this {
    this.reporter.emit('test:pass', { title, fullTitle: title, uid, cid: '0-0', type: 'test:pass' });
    this.reporter.emit('test:end', { title, fullTitle: title, uid, cid: '0-0', type: 'test:end' });
    return this;
  }

  fail(uid: string, title: string, message: string): this {
    this.reporter.emit('test:fail', { title, fullTitle: title, uid, cid: '0-0', type: 'test:fail', error: { message, stack: `Error: ${message}\n    at spec.js:1:1` } });
    this.reporter.emit('test:end', { title, fullTitle: title, uid, cid: '0-0', type: 'test:end' });
    return this;
  }

  retry(uid: string, title: string, message: string): this {
    this.reporter.emit('test:retry', { title, fullTitle: title, uid, cid: '0-0', type: 'test:retry', error: { message } });
    return this;
  }

  pending(title: string): this {
    const uid = `test-${this.n++}`;
    this.reporter.emit('test:pending', { title, fullTitle: title, uid, cid: '0-0', type: 'test:pending', pending: true, state: 'pending' });
    return this;
  }

  hook(title: string): this {
    this.reporter.emit('hook:start', { title, uid: `hook-${this.n++}`, cid: '0-0', parent: '' });
    return this;
  }

  screenshot(): this {
    this.reporter.emit('client:afterCommand', {
      command: 'takeScreenshot',
      endpoint: '/session/:sessionId/screenshot',
      method: 'GET',
      body: {},
      result: { value: PNG_BASE64 },
      sessionId: 's',
      cid: '0-0',
    });
    return this;
  }

  end(): Collect[] {
    this.reporter.emit('runner:end', { failures: 0, cid: '0-0', retries: 0 });
    return reports();
  }
}

function reports(): Collect[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Collect);
}

describe('QualflareWebdriverioReporter', () => {
  it('writes one report per worker, named by UUID and labelled webdriverio', () => {
    const run = new Run(makeReporter()).start().suite('Login');
    run.pass(run.test('signs in'), 'signs in');
    run.endSuite('Login');
    const [report, ...rest] = run.end();

    expect(rest).toHaveLength(0);
    // Never a name containing "webdriver": qf collect would route it to Selenium.
    const [file] = fs.readdirSync(dir);
    expect(file).toMatch(/^[0-9a-f-]{36}\.json$/);

    expect(report!.framework).toBe('webdriverio');
    expect(report!.platform).toBe('web');
    expect(report!.browser).toBe('chrome');
    expect(report!.metadata.cliName).toBe('qualflare-webdriverio');
    expect(report!.metadata.runId).toBe('run-under-test');
    expect(report!.suites[0]!.name).toBe('test/specs/login.spec.js');
    expect(report!.suites[0]!.category).toBe('webdriverio');
  });

  it('names a test by its describe chain joined with spaces, and keys it by file, name and capability', () => {
    const run = new Run(makeReporter()).start().suite('Checkout').suite('as a guest');
    run.pass(run.test('pays by card'), 'pays by card');
    const testCase = run.end()[0]!.suites[0]!.cases[0]!;

    expect(testCase.name).toBe('Checkout as a guest pays by card');
    expect(testCase.id).toBe('test/specs/login.spec.js#Checkout as a guest pays by card@chrome');
    expect(testCase.properties).toMatchObject({
      file: 'test/specs/login.spec.js',
      browserName: 'chrome',
      browserVersion: '140.0',
    });
  });

  it('keeps the histories of two capabilities apart', () => {
    const chrome = new Run(makeReporter()).start(CHROME).suite('S');
    chrome.pass(chrome.test('t'), 't');
    chrome.end();
    const firefox = new Run(makeReporter()).start({ browserName: 'firefox' }).suite('S');
    firefox.pass(firefox.test('t'), 't');
    firefox.end();

    const ids = reports().map((r) => r.suites[0]!.cases[0]!.id).sort();
    expect(ids).toEqual(['test/specs/login.spec.js#S t@chrome', 'test/specs/login.spec.js#S t@firefox']);
  });

  it('groups retried attempts into one flaky case, with every attempt timed and the failure kept', () => {
    const run = new Run(makeReporter()).start().suite('Suite A');
    const first = run.test('is flaky once');
    run.retry(first, 'is flaky once', 'boom 1');
    const second = run.test('is flaky once');
    run.pass(second, 'is flaky once');
    const cases = run.end()[0]!.suites[0]!.cases;

    expect(cases).toHaveLength(1);
    const testCase = cases[0]!;
    expect(testCase.status).toBe('passed');
    expect(testCase.isFlaky).toBe(true);
    expect(testCase.retryCount).toBe(1);
    expect(testCase.attempts!.map((a) => [a.attempt, a.status, a.message])).toEqual([
      [1, 'failed', 'boom 1'],
      [2, 'passed', undefined],
    ]);
    expect(testCase.attempts!.every((a) => typeof a.startedAt === 'string')).toBe(true);
  });

  it('is not flaky when it failed after retries', () => {
    const run = new Run(makeReporter()).start().suite('S');
    const a = run.test('t');
    run.retry(a, 't', 'first');
    run.fail(run.test('t'), 't', 'second');
    const testCase = run.end()[0]!.suites[0]!.cases[0]!;
    expect(testCase.status).toBe('failed');
    expect(testCase.isFlaky).toBe(false);
    expect(testCase.error).toBe('second');
    expect(testCase.trace).toContain('spec.js:1:1');
  });

  it('reports skipped tests that never started', () => {
    const run = new Run(makeReporter()).start().suite('S');
    run.pending('later');
    const testCase = run.end()[0]!.suites[0]!.cases[0]!;
    expect(testCase.status).toBe('skipped');
    expect(testCase.name).toBe('S later');
  });

  it('reports a test the worker ended under as error, not as a failure', () => {
    const run = new Run(makeReporter()).start().suite('S');
    run.test('hangs');
    const testCase = run.end()[0]!.suites[0]!.cases[0]!;
    expect(testCase.status).toBe('error');
  });

  describe('metadata and screenshots', () => {
    it('attributes qualflare.*() calls made in the body and in afterEach, after the verdict', () => {
      const run = new Run(makeReporter()).start().suite('S');
      const uid = run.test('t');
      qualflare.label('owner', 'payments');
      run.pass(uid, 't');
      qualflare.tag('from-after-each');
      const testCase = run.end()[0]!.suites[0]!.cases[0]!;
      expect(testCase.labels).toEqual([{ name: 'owner', value: 'payments' }]);
      expect(testCase.tags).toEqual(['from-after-each']);
    });

    // Misattribution is worse than absence: an `after all` hook belongs to no
    // single test, so what it records is dropped.
    it('closes the window when an "after all" hook starts', () => {
      const run = new Run(makeReporter()).start().suite('S');
      run.pass(run.test('t'), 't');
      run.hook('"after all" hook in "S"');
      qualflare.tag('from-after-all');
      run.screenshot();
      const testCase = run.end()[0]!.suites[0]!.cases[0]!;
      expect(testCase.tags).toBeUndefined();
      expect(testCase.attachments).toBeUndefined();
    });

    it('keeps only the final attempt\'s metadata', () => {
      const run = new Run(makeReporter()).start().suite('S');
      const a = run.test('t');
      qualflare.label('attempt', '1');
      run.retry(a, 't', 'x');
      run.test('t');
      qualflare.label('attempt', '2');
      run.pass('test-1', 't');
      const testCase = run.end()[0]!.suites[0]!.cases[0]!;
      expect(testCase.labels).toEqual([{ name: 'attempt', value: '2' }]);
    });

    it('writes screenshots beside the report and labels them by attempt when the test was retried', () => {
      const run = new Run(makeReporter()).start().suite('S');
      const a = run.test('t');
      run.screenshot();
      run.retry(a, 't', 'x');
      const b = run.test('t');
      run.pass(b, 't');
      run.screenshot(); // afterEach, after the verdict
      const testCase = run.end()[0]!.suites[0]!.cases[0]!;

      expect(testCase.attachments!.map((x) => x.name)).toEqual([
        'Screenshot 1 (attempt 1)',
        'Screenshot 2 (attempt 2)',
      ]);
      for (const attachment of testCase.attachments!) {
        expect(attachment.mimeType).toBe('image/png');
        expect(fs.existsSync(path.join(dir, attachment.localImagePath!))).toBe(true);
      }
    });

    it('can be turned off', () => {
      const run = new Run(makeReporter({ screenshots: false })).start().suite('S');
      const uid = run.test('t');
      run.screenshot();
      run.pass(uid, 't');
      expect(run.end()[0]!.suites[0]!.cases[0]!.attachments).toBeUndefined();
    });
  });

  describe('platform', () => {
    it('is ios for an Appium Safari session, with the device on every case', () => {
      const run = new Run(makeReporter())
        .start({ platformName: 'iOS', browserName: 'Safari', deviceName: 'iPhone 17 Pro', platform: 'MAC' })
        .suite('S');
      run.pass(run.test('t'), 't');
      const report = run.end()[0]!;
      expect(report.platform).toBe('ios');
      expect(report.suites[0]!.cases[0]!.properties).toMatchObject({ deviceName: 'iPhone 17 Pro' });
      expect(report.suites[0]!.cases[0]!.id.endsWith('@ios-safari')).toBe(true);
    });

    it('is omitted for multiremote rather than guessed', () => {
      const run = new Run(makeReporter()).start({ a: {}, b: {} }, true).suite('S');
      run.pass(run.test('t'), 't');
      expect(run.end()[0]!).not.toHaveProperty('platform');
    });
  });

  it('labels appium when composed by @qualflare/appium', () => {
    const run = new Run(makeReporter({ framework: 'appium' })).start().suite('S');
    run.pass(run.test('t'), 't');
    const report = run.end()[0]!;
    expect(report.framework).toBe('appium');
    expect(report.suites[0]!.category).toBe('appium');
  });

  it('writes nothing when disabled', () => {
    const run = new Run(makeReporter({ enabled: false })).start().suite('S');
    run.pass(run.test('t'), 't');
    expect(run.end()).toEqual([]);
  });
});
