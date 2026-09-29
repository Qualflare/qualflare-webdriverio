/**
 * What a session's capabilities say about where the tests ran.
 *
 * Read once per worker, at `onRunnerStart`, from the capabilities WebdriverIO
 * hands the reporter. Every rule below was measured against a real session, not
 * taken from documentation:
 *
 * - Appium's XCUITest driver returns its keys UNPREFIXED (`platformName`,
 *   `deviceName`, `platformVersion`, `automationName`), although the request
 *   sends them as `appium:*`. Older servers nest the request under `desired`.
 *   So each key is read unprefixed, then `appium:`-prefixed, then from
 *   `desired`, in that order.
 * - Mobile Safari reports BOTH `browserName: 'Safari'` and `platformName: 'iOS'`.
 *   Checking the browser first would label an iOS run `web`, so the platform is
 *   decided by `platformName` first.
 * - The same session also carries a legacy `platform: 'MAC'` for an iOS
 *   simulator. That key is never read, anywhere.
 * - Desktop Chrome returns `platformName: 'mac'`/`'linux'`/`'windows'`, which is
 *   the host OS rather than a platform in Qualflare's sense. With a browser
 *   present, that is `web`.
 *
 * When nothing identifies the platform — multiremote, or capabilities that name
 * neither a mobile platform, a browser nor a desktop driver — it is left unset
 * rather than guessed. The server's platform is a closed set, and a wrong value
 * is worse than none; `--platform` on `qf collect` fills the gap.
 */
import type { Platform } from '../shared/types.js';

export interface CapabilityInfo {
  /** Undefined when the capabilities do not determine one. */
  platform?: Platform;
  /** The browser name as the session reported it, or undefined for a native
   * app session. */
  browser?: string;
  /**
   * Distinguishes one capability's results from another's in the case id, so a
   * suite run on Chrome and Firefox — or iOS and Android — keeps two histories
   * instead of merging them. Deliberately coarse: it leaves out device models
   * and versions, so moving the suite to a newer simulator keeps its history.
   */
  key: string;
  /** Capability values recorded on every case, so a result says which device
   * or browser produced it even when the key does not. */
  properties: Record<string, string>;
}

type Caps = Record<string, unknown>;

/** The capability keys copied onto each case, in the order they are read. */
const RECORDED_KEYS = [
  'platformName',
  'platformVersion',
  'deviceName',
  'automationName',
  'browserName',
  'browserVersion',
] as const;

function isRecord(value: unknown): value is Caps {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads one capability, tolerating each spelling a real session uses. */
export function readCapability(caps: Caps, name: string): string | undefined {
  const desired = isRecord(caps.desired) ? caps.desired : {};
  for (const value of [caps[name], caps[`appium:${name}`], desired[name], desired[`appium:${name}`]]) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
    if (typeof value === 'number') {
      return String(value);
    }
  }
  return undefined;
}

function mobilePlatform(platformName: string | undefined): Platform | undefined {
  switch (platformName?.toLowerCase()) {
    case 'ios':
    case 'tvos':
      return 'ios';
    case 'android':
      return 'android';
    default:
      return undefined;
  }
}

/** Appium's desktop drivers, keyed by `automationName` in lower case. */
const DESKTOP_DRIVERS = new Set(['mac2', 'windows', 'novawindows', 'linux']);

export function resolveCapabilities(capabilities: unknown, isMultiremote: boolean): CapabilityInfo {
  if (isMultiremote || !isRecord(capabilities)) {
    // A multiremote session is several browsers or devices at once, so no
    // single platform or browser is true of it.
    return { key: 'multiremote', properties: {} };
  }

  const properties: Record<string, string> = {};
  for (const name of RECORDED_KEYS) {
    const value = readCapability(capabilities, name);
    if (value !== undefined) {
      properties[name] = value;
    }
  }

  const platformName = properties.platformName;
  const browserName = properties.browserName;
  const automationName = properties.automationName?.toLowerCase();

  const mobile = mobilePlatform(platformName);
  if (mobile) {
    return {
      platform: mobile,
      ...(browserName ? { browser: browserName } : {}),
      key: browserName ? `${mobile}-${browserName.toLowerCase()}` : mobile,
      properties,
    };
  }

  if (browserName) {
    return { platform: 'web', browser: browserName, key: browserName.toLowerCase(), properties };
  }

  if (automationName && DESKTOP_DRIVERS.has(automationName)) {
    return { platform: 'desktop', key: `desktop-${automationName}`, properties };
  }

  return { key: 'unknown', properties };
}
