import * as os from 'node:os';

import { PACKAGE_VERSION } from '../config/version.js';
import type { ResolvedReporterConfig } from '../config/resolve-config.js';
import type { Collect, Platform, Suite } from '../shared/types.js';

/** `metadata.cliName` of every report this package writes, including through
 * @qualflare/appium. `QualflareService` recognizes its own stale reports by it. */
export const CLI_NAME = 'qualflare-webdriverio';

function resolveOs(config: ResolvedReporterConfig): string {
  if (config.os) {
    return config.os;
  }
  return `${os.type()} ${os.release()}`;
}

/**
 * Assembles one worker's report.
 *
 * `metadata` is not optional decoration: `qualflare-cli` identifies this format
 * by `framework` + `metadata` + `suites` together, and falls back to filename
 * matching without it. For the same reason this payload must never grow a
 * top-level `config` key -- that is the Playwright-JSON detector's signature.
 *
 * `platform` and `browser` come from this worker's session capabilities unless
 * set explicitly. The CLI records them per file and promotes them to the launch
 * only when every file agrees, so a run across iOS and Android says neither
 * rather than whichever finished last. `platform` is omitted, not guessed, when
 * the capabilities do not determine it.
 */
export function buildCollectPayload(
  suites: Suite[],
  config: ResolvedReporterConfig,
  session: { platform?: Platform; browser?: string } = {},
): Collect {
  const platform = config.platform ?? session.platform;
  return {
    framework: config.framework,
    ...(platform ? { platform } : {}),
    os: resolveOs(config),
    browser: (config.browser ?? session.browser ?? '').slice(0, 64),
    branch: config.branch,
    commit: config.commit,
    environment: config.environment,
    language: config.language,
    milestone: config.milestone,
    metadata: {
      version: PACKAGE_VERSION,
      timestamp: new Date().toISOString(),
      cliName: CLI_NAME,
      runId: config.runId,
    },
    properties: config.properties,
    suites,
    ciProvider: config.ciProvider,
    ciBuildNumber: config.ciBuildNumber,
    ciRunUrl: config.ciRunUrl,
    ciPrNumber: config.ciPrNumber,
  };
}
