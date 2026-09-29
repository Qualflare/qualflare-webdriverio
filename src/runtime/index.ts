/**
 * `@qualflare/webdriverio/runtime`: the metadata API alone.
 *
 * A separate entry so a spec file can import `qualflare` without loading the
 * reporter and `@wdio/reporter` behind it. It pulls in nothing but this
 * package's own few modules.
 */
export { qualflare } from './qualflare-api.js';
