/**
 * `@qualflare/webdriverio`.
 *
 * The DEFAULT export is the reporter, because that is what WebdriverIO takes
 * from a module named in `reporters: ['@qualflare/webdriverio']`.
 *
 * This entry deliberately exports NO `launcher`. WebdriverIO takes a string
 * entry in `services` as a module whose `launcher` export is the launcher
 * service and whose `default` is the worker service -- so a `launcher` here would
 * make `services: ['@qualflare/webdriverio']` construct the REPORTER as a worker
 * service. The string form lives at `@qualflare/webdriverio/service`.
 */
import { QualflareWebdriverioReporter } from './reporter/reporter.js';

export default QualflareWebdriverioReporter;
export { QualflareWebdriverioReporter };
export { QualflareService, type QualflareServiceOptions } from './service.js';
export { ensureRunId } from './run-id.js';
export { qualflare } from './runtime/qualflare-api.js';
export { resolveCapabilities, type CapabilityInfo } from './config/capabilities.js';

export type { QualflareWebdriverioOptions } from './config/resolve-config.js';
export type {
  Attachment,
  Case,
  CasePriority,
  CaseStatus,
  Collect,
  FrameworkCategory,
  Label,
  Link,
  LinkType,
  Metadata,
  NanosecondDuration,
  Parameter,
  Platform,
  Step,
  Suite,
} from './shared/types.js';
