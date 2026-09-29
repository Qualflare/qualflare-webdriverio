import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { readCapability, resolveCapabilities } from '../../src/config/capabilities.js';

const realAppium = JSON.parse(
  readFileSync(new URL('../fixtures/appium-xcuitest-safari-caps.json', import.meta.url), 'utf8'),
).capabilities as Record<string, unknown>;

describe('resolveCapabilities — a real Appium XCUITest session', () => {
  const info = resolveCapabilities(realAppium, false);

  // The session reports browserName Safari AND platformName iOS. Deciding by
  // the browser first would label every mobile-Safari run "web".
  it('is ios, not web, although it also names a browser', () => {
    expect(info.platform).toBe('ios');
    expect(info.browser).toBe('Safari');
    expect(info.key).toBe('ios-safari');
  });

  // The same session carries a legacy `platform: MAC` for an iOS simulator.
  it('never reads the legacy platform capability', () => {
    expect(realAppium.platform).toBe('MAC');
    expect(info.platform).not.toBe('desktop');
    expect(Object.values(info.properties)).not.toContain('MAC');
  });

  it('records the device on every case', () => {
    expect(info.properties).toEqual({
      platformName: 'iOS',
      platformVersion: '26.5',
      deviceName: 'iPhone 17 Pro',
      automationName: 'XCUITest',
      browserName: 'Safari',
    });
  });
});

describe('resolveCapabilities — platform order', () => {
  it('desktop Chrome is web, whatever host OS platformName names', () => {
    for (const platformName of ['mac', 'linux', 'windows']) {
      const info = resolveCapabilities({ browserName: 'chrome', browserVersion: '140.0', platformName }, false);
      expect(info.platform).toBe('web');
      expect(info.key).toBe('chrome');
    }
  });

  it('a native Android app is android, keyed without a browser', () => {
    const info = resolveCapabilities({ platformName: 'Android', 'appium:automationName': 'UiAutomator2' }, false);
    expect(info.platform).toBe('android');
    expect(info.browser).toBeUndefined();
    expect(info.key).toBe('android');
  });

  it('the mac2 and windows drivers are desktop', () => {
    expect(resolveCapabilities({ platformName: 'mac', 'appium:automationName': 'Mac2' }, false).platform).toBe(
      'desktop',
    );
    expect(resolveCapabilities({ platformName: 'windows', 'appium:automationName': 'Windows' }, false).key).toBe(
      'desktop-windows',
    );
  });

  // The server's platform is a closed set; a guess is worse than nothing.
  it('leaves the platform unset when nothing determines it', () => {
    const info = resolveCapabilities({ platformName: 'linux' }, false);
    expect(info.platform).toBeUndefined();
    expect(info.key).toBe('unknown');
  });

  it('leaves multiremote unset: several browsers are not one platform', () => {
    const info = resolveCapabilities({ a: { capabilities: { browserName: 'chrome' } } }, true);
    expect(info).toEqual({ key: 'multiremote', properties: {} });
  });
});

describe('readCapability', () => {
  it('reads unprefixed, then appium:-prefixed, then desired', () => {
    expect(readCapability({ deviceName: 'a', 'appium:deviceName': 'b' }, 'deviceName')).toBe('a');
    expect(readCapability({ 'appium:deviceName': 'b' }, 'deviceName')).toBe('b');
    expect(readCapability({ desired: { deviceName: 'c' } }, 'deviceName')).toBe('c');
    expect(readCapability({ desired: { 'appium:deviceName': 'd' } }, 'deviceName')).toBe('d');
  });

  it('ignores blank values and stringifies numbers', () => {
    expect(readCapability({ deviceName: '  ', 'appium:deviceName': 'b' }, 'deviceName')).toBe('b');
    expect(readCapability({ platformVersion: 17 }, 'platformVersion')).toBe('17');
  });
});
