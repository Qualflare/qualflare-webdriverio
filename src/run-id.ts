import { randomUUID } from 'node:crypto';

import { detectCi } from './config/ci-detect.js';

/** A fresh run identifier. */
export function mintRunId(): string {
  return randomUUID();
}

/**
 * Makes sure every worker of this run shares one `QUALFLARE_RUN_ID`, for
 * configurations that cannot use `QualflareService`. Call it at the top of
 * `wdio.conf`, before `export const config`:
 *
 * ```js
 * import { ensureRunId } from '@qualflare/webdriverio';
 * ensureRunId();
 * ```
 *
 * `wdio.conf` is evaluated in the launcher AND again in every worker, so a plain
 * `process.env.QUALFLARE_RUN_ID ??= randomUUID()` would still give each worker
 * its own id. The id is minted only in the launcher -- recognized by the absence
 * of `WDIO_WORKER_ID`, which WebdriverIO sets on each worker -- and the workers
 * inherit it. Inside CI the provider's run id is used instead, and nothing is set.
 *
 * Returns the id in effect, or undefined in a worker that has none (which means
 * the launcher did not call this).
 */
export function ensureRunId(): string | undefined {
  const existing = process.env.QUALFLARE_RUN_ID;
  if (existing) {
    return existing;
  }
  const ciRunId = detectCi().ciRunId;
  if (ciRunId) {
    return ciRunId;
  }
  if (process.env.WDIO_WORKER_ID) {
    return undefined;
  }
  const minted = mintRunId();
  process.env.QUALFLARE_RUN_ID = minted;
  return minted;
}
