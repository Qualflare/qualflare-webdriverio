import { randomUUID } from 'node:crypto';

import type { Platform } from '../shared/types.js';
import { detectCi, type CiMetadata } from './ci-detect.js';
import { detectGit, type GitInfo } from './git-detect.js';

/** Options for the reporter, passed as the second element of its entry in
 * `wdio.conf`'s `reporters`: `[['@qualflare/webdriverio', { ... }]]`. Every
 * field here also has an environment-variable override — see the precedence
 * table in `docs/CONFIGURATION.md`.
 *
 * WebdriverIO merges its own keys into this same object before constructing the
 * reporter (`logFile`, `writeStream`, and `outputDir` if the user set one), so
 * every unknown key is ignored rather than rejected. */
export interface QualflareWebdriverioOptions {
  environment?: string;
  language?: string;
  milestone?: number | null;
  branch?: string | null;
  commit?: string | null;
  /** Overrides the platform derived from the session's capabilities. Needed
   * only for multiremote, where no single platform is true. */
  platform?: Platform;
  os?: string;
  /** Overrides the browser derived from the session's capabilities. */
  browser?: string;
  properties?: Record<string, string>;
  /** Max 64 chars. Free text, no enum — an unrecognized CI provider must
   * never be rejected. Auto-detected via `ci-detect.ts` when omitted. */
  ciProvider?: string;
  ciBuildNumber?: string;
  ciRunUrl?: string;
  ciPrNumber?: number;
  /** Identifier shared by every worker of one run, written into the report as
   * `metadata.runId`. `qf collect` keeps only the files of the NEWEST run it
   * finds, so every worker of one run must agree on this value — which is what
   * `QualflareService` arranges. See `docs/CONFIGURATION.md`. */
  runId?: string;
  maxAttachmentBytes?: number;
  maxTotalAttachmentBytes?: number;
  debug?: boolean;
  /** `false` makes the reporter a complete no-op. */
  enabled?: boolean;
  /** Directory each worker writes its report file (and screenshots) into.
   * Default `./qualflare-results`.
   *
   * NOT called `outputDir`: WebdriverIO reads a reporter option of that name as
   * the directory for the reporter's own log file, so a shared name would put
   * WebdriverIO's logs among the reports. Measured, not assumed. */
  resultsDir?: string;
  /** Attach the screenshots WebdriverIO takes (`browser.takeScreenshot()`,
   * `saveScreenshot()`, element screenshots) to the test they belong to.
   * Default `true`. */
  screenshots?: boolean;
  /** This worker's 0-based shard position, stamped onto every case. Detected
   * from WebdriverIO's `--shard` when omitted. Purely a label. */
  shardIndex?: number;
  /**
   * The framework label. Set by `@qualflare/appium`, which composes this
   * reporter; leave it unset otherwise. Each package reports its own name.
   * @internal
   */
  framework?: 'webdriverio' | 'appium';
}

/** Where the resolved runId came from. `launcher` is derived by each worker
 * from the `wdio run` process (see launcher-id.ts) and replaces `random` when
 * that lookup succeeds; `random` is the one that breaks multi-worker runs, and
 * the reporter warns about it. */
export type RunIdSource = 'option' | 'env' | 'ci' | 'launcher' | 'random';

export interface ResolvedReporterConfig {
  environment: string;
  language: string;
  milestone: number | null;
  branch: string | null;
  commit: string | null;
  platform?: Platform;
  framework: 'webdriverio' | 'appium';
  os?: string;
  browser?: string;
  properties?: Record<string, string>;
  ciProvider?: string;
  ciBuildNumber?: string;
  ciRunUrl?: string;
  ciPrNumber?: number;
  runId: string;
  runIdSource: RunIdSource;
  maxAttachmentBytes: number;
  maxTotalAttachmentBytes: number;
  debug: boolean;
  enabled: boolean;
  /** Named `outputDir` internally so the shared attachment writers, which are
   * identical across the reporter family, read it unchanged. */
  outputDir: string;
  screenshots: boolean;
  shardIndex?: number;
}

export const DEFAULT_RESULTS_DIR = './qualflare-results';

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== '') {
      return value;
    }
  }
  return undefined;
}

function envBool(...names: string[]): boolean | undefined {
  const raw = firstEnv(...names);
  if (raw === undefined) {
    return undefined;
  }
  return raw === 'true' || raw === '1';
}

function envInt(...names: string[]): number | undefined {
  const raw = firstEnv(...names);
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** The results directory, resolved the same way by the reporter (in each
 * worker) and by `QualflareService` (in the launcher), so the launcher cleans
 * the directory the workers write. */
export function resolveResultsDir(resultsDir: string | undefined): string {
  // `||`, not `??`: an explicit empty string is a mistake, not a choice.
  return resultsDir || firstEnv('QUALFLARE_RESULTS_DIR', 'QUALFLARE_OUTPUT_DIR') || DEFAULT_RESULTS_DIR;
}

/** Resolves the full reporter configuration from, in order: the explicit
 * `options`, then `QUALFLARE_*` environment variables, then `QF_*` (compat
 * alias with the Go CLI, where an equivalent exists), then a default.
 *
 * Branch/commit precedence: `options.branch`/`.commit` (an explicit `null` is
 * respected as "no auto-detection wanted") > `QUALFLARE_BRANCH`/`QF_BRANCH` env
 * > CI-provider env vars > a local `git` subprocess > `null`. No `git` process
 * is forked once both are already resolved.
 *
 * `deps` lets tests inject fake detectors instead of the real ones, which shell
 * out to `git` and read the real environment. */
export function resolveConfig(
  options: QualflareWebdriverioOptions,
  deps: { detectGit?: () => GitInfo; detectCi?: () => CiMetadata } = {},
): ResolvedReporterConfig {
  const doDetectGit = deps.detectGit ?? detectGit;
  const doDetectCi = deps.detectCi ?? detectCi;

  const enabled = options.enabled ?? envBool('QUALFLARE_ENABLED') ?? true;
  const shardIndex = options.shardIndex ?? envInt('QUALFLARE_SHARD_INDEX');

  const milestoneRaw =
    options.milestone !== undefined ? options.milestone : envInt('QUALFLARE_MILESTONE', 'QF_MILESTONE');
  const milestone = milestoneRaw !== undefined && milestoneRaw !== null && milestoneRaw >= 1 ? milestoneRaw : null;

  const envBranch = firstEnv('QUALFLARE_BRANCH', 'QF_BRANCH');
  const envCommit = firstEnv('QUALFLARE_COMMIT', 'QF_COMMIT');
  const needsGitDetection =
    (options.branch === undefined && envBranch === undefined) ||
    (options.commit === undefined && envCommit === undefined);
  const detectedGit = needsGitDetection ? doDetectGit() : {};

  const branch = options.branch !== undefined ? options.branch : (envBranch ?? detectedGit.branch ?? null);
  const commit = options.commit !== undefined ? options.commit : (envCommit ?? detectedGit.commit ?? null);

  const detectedCi = doDetectCi();

  // Never empty: `qf collect` treats a report with no runId as "unknown run"
  // and never lets it block a merge, which would opt out of the check this
  // exists for. The random fallback is correct for ONE process and wrong for a
  // WebdriverIO run, which is several worker processes — hence runIdSource.
  let runId: string;
  let runIdSource: RunIdSource;
  const envRunId = firstEnv('QUALFLARE_RUN_ID');
  if (options.runId) {
    runId = options.runId;
    runIdSource = 'option';
  } else if (envRunId) {
    runId = envRunId;
    runIdSource = 'env';
  } else if (detectedCi.ciRunId) {
    runId = detectedCi.ciRunId;
    runIdSource = 'ci';
  } else {
    runId = randomUUID();
    runIdSource = 'random';
  }

  return {
    // `||`, not `??`, for the required-non-empty wire fields: an explicit ''
    // must not win over the default (the server rejects an empty environment).
    environment:
      (options.environment || undefined) ?? firstEnv('QUALFLARE_ENVIRONMENT', 'QF_ENVIRONMENT') ?? 'development',
    language: (options.language || undefined) ?? firstEnv('QUALFLARE_LANGUAGE', 'QF_LANGUAGE') ?? 'en-US',
    milestone,
    branch,
    commit,
    ...(options.platform ? { platform: options.platform } : {}),
    framework: options.framework === 'appium' ? 'appium' : 'webdriverio',
    os: options.os,
    browser: options.browser,
    properties: options.properties,
    ciProvider: options.ciProvider ?? detectedCi.ciProvider,
    ciBuildNumber: options.ciBuildNumber ?? detectedCi.ciBuildNumber,
    ciRunUrl: options.ciRunUrl ?? detectedCi.ciRunUrl,
    ciPrNumber: options.ciPrNumber ?? detectedCi.ciPrNumber,
    runId,
    runIdSource,
    // 5MB per attachment, 10MB per worker. @qualflare/cli v0.1.22+ uploads
    // attachments out of band, so these only bound the report on disk.
    maxAttachmentBytes: options.maxAttachmentBytes ?? envInt('QUALFLARE_MAX_ATTACHMENT_BYTES') ?? 5_000_000,
    maxTotalAttachmentBytes:
      options.maxTotalAttachmentBytes ?? envInt('QUALFLARE_MAX_TOTAL_ATTACHMENT_BYTES') ?? 10_000_000,
    debug: options.debug ?? envBool('QUALFLARE_DEBUG', 'QF_DEBUG') ?? false,
    enabled,
    outputDir: resolveResultsDir(options.resultsDir),
    screenshots: options.screenshots ?? envBool('QUALFLARE_SCREENSHOTS') ?? true,
    shardIndex,
  };
}
