/**
 * `@qualflare/webdriverio/service`, for the string form:
 *
 * ```js
 * services: [['@qualflare/webdriverio/service', { resultsDir: './qualflare-results' }]]
 * ```
 *
 * WebdriverIO constructs a string entry's `launcher` export in the launcher. It
 * finds no `default` here, so it constructs nothing in the workers -- the
 * service has no worker-side work to do.
 */
import { QualflareService } from './service.js';

export const launcher = QualflareService;
export { QualflareService };
