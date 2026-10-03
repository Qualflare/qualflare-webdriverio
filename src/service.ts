/**
 * The launcher service: one runId for every worker, and a clean results
 * directory.
 *
 * OPTIONAL SINCE 0.2.0, BUT NOT REDUNDANT
 *
 * Each spec file runs in its own worker process, each worker writes its own
 * report, and `qf collect` keeps only the files of the NEWEST `runId` it finds.
 * Measured: two workers with different runIds uploaded one worker's cases, and
 * the only trace was "ignored 1 file(s) from 1 earlier run(s)". Without this
 * service, each worker now derives the same id from the `wdio run` launcher
 * process (config/launcher-id.ts). That cannot separate two programmatic
 * `Launcher` runs inside one Node process, which share the process: this
 * service can, because `onPrepare` runs once per run, in the launcher, and
 * `onComplete` clears what it set. It also cleans stale reports.
 *
 * Inside CI the provider's run id is already shared by every worker (and by
 * every machine of a sharded job), so the service leaves it alone. Replacing it
 * with a fresh UUID would split a sharded run into per-machine runs.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { detectCi } from './config/ci-detect.js';
import { resolveResultsDir } from './config/resolve-config.js';
import { mintRunId } from './run-id.js';
import { CLI_NAME } from './reporter/collect-builder.js';
import { logger } from './shared/logger.js';

export interface QualflareServiceOptions {
  /** Must match the reporter's `resultsDir` if you changed it. */
  resultsDir?: string;
  /** Delete this package's reports from EARLIER runs before the run starts.
   * Default `true`. Reports from the current run are never touched. */
  clean?: boolean;
}

export class QualflareService {
  private readonly options: QualflareServiceOptions;
  private mintedRunId = false;

  constructor(options: QualflareServiceOptions = {}) {
    this.options = options;
  }

  onPrepare(): void {
    if (!process.env.QUALFLARE_RUN_ID && !detectCi().ciRunId) {
      process.env.QUALFLARE_RUN_ID = mintRunId();
      this.mintedRunId = true;
    }
    if (this.options.clean !== false) {
      const runId = process.env.QUALFLARE_RUN_ID ?? detectCi().ciRunId;
      cleanStaleReports(resolveResultsDir(this.options.resultsDir), runId);
    }
  }

  /** Undoes what `onPrepare` set, so a programmatic `Launcher` reused in the
   * same process starts its next run with a new id instead of this one. */
  onComplete(): void {
    if (this.mintedRunId) {
      delete process.env.QUALFLARE_RUN_ID;
      this.mintedRunId = false;
    }
  }
}

/**
 * Deletes this package's reports whose runId is not `currentRunId`, and the
 * screenshots they reference.
 *
 * Recognized by content (`metadata.cliName`), never by filename, so nothing in
 * the directory that another tool wrote is touched. Reports of the CURRENT run
 * are kept: in CI two `wdio` invocations of one job share the provider's run id,
 * and the second must not delete the first's results.
 */
export function cleanStaleReports(dir: string, currentRunId: string | undefined): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return; // No directory yet: nothing to clean.
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue;
    }
    const file = path.join(dir, entry);
    let report: { metadata?: { cliName?: unknown; runId?: unknown }; suites?: unknown };
    try {
      report = JSON.parse(fs.readFileSync(file, 'utf8')) as typeof report;
    } catch {
      continue;
    }
    if (report.metadata?.cliName !== CLI_NAME || report.metadata.runId === currentRunId) {
      continue;
    }
    for (const image of referencedImages(report.suites)) {
      // basename: a crafted report must not be able to point outside the dir.
      tryRemove(path.join(dir, path.basename(image)));
    }
    if (tryRemove(file)) {
      removed += 1;
    }
  }
  if (removed > 0) {
    logger.info(`removed ${removed} report(s) from earlier runs in ${dir}`);
  }
}

function referencedImages(suites: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(suites)) {
    return out;
  }
  for (const suite of suites as { cases?: { attachments?: { localImagePath?: unknown }[] }[] }[]) {
    for (const testCase of suite?.cases ?? []) {
      for (const attachment of testCase?.attachments ?? []) {
        if (typeof attachment?.localImagePath === 'string' && attachment.localImagePath !== '') {
          out.push(attachment.localImagePath);
        }
      }
    }
  }
  return out;
}

function tryRemove(file: string): boolean {
  try {
    fs.rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

export default QualflareService;
