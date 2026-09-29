import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveConfig } from '../../src/config/resolve-config.js';

// Stub both detectors so nothing forks `git` or reads the ambient CI env.
const NOOP_DEPS = { detectGit: () => ({}), detectCi: () => ({}) };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveConfig — resultsDir', () => {
  it('defaults to ./qualflare-results', () => {
    expect(resolveConfig({}, NOOP_DEPS).outputDir).toBe('./qualflare-results');
  });

  it('honors resultsDir', () => {
    expect(resolveConfig({ resultsDir: './custom' }, NOOP_DEPS).outputDir).toBe('./custom');
  });

  // WebdriverIO reads a reporter option named outputDir as the directory for
  // the reporter's own log file. Honoring it here too would put WebdriverIO's
  // logs among the reports that qf collect reads.
  it('ignores outputDir, which is WebdriverIO\'s log directory', () => {
    const options = { outputDir: './wdio-logs' } as Record<string, unknown>;
    expect(resolveConfig(options, NOOP_DEPS).outputDir).toBe('./qualflare-results');
  });

  it('reads QUALFLARE_RESULTS_DIR, and QUALFLARE_OUTPUT_DIR as the family-wide alias', () => {
    vi.stubEnv('QUALFLARE_OUTPUT_DIR', './from-alias');
    expect(resolveConfig({}, NOOP_DEPS).outputDir).toBe('./from-alias');
    vi.stubEnv('QUALFLARE_RESULTS_DIR', './from-env');
    expect(resolveConfig({}, NOOP_DEPS).outputDir).toBe('./from-env');
  });

  it('an explicit option beats the environment, and "" falls through to the default', () => {
    vi.stubEnv('QUALFLARE_RESULTS_DIR', './from-env');
    expect(resolveConfig({ resultsDir: './from-option' }, NOOP_DEPS).outputDir).toBe('./from-option');
    vi.unstubAllEnvs();
    expect(resolveConfig({ resultsDir: '' }, NOOP_DEPS).outputDir).toBe('./qualflare-results');
  });
});

describe('resolveConfig — framework label', () => {
  it('is webdriverio by default', () => {
    expect(resolveConfig({}, NOOP_DEPS).framework).toBe('webdriverio');
  });

  it('is appium when @qualflare/appium composes this reporter', () => {
    expect(resolveConfig({ framework: 'appium' }, NOOP_DEPS).framework).toBe('appium');
  });

  // The label is what the server validates against its test_type enum; an
  // unknown one would 400 the whole launch.
  it('never passes an arbitrary value through', () => {
    const options = { framework: 'selenium' } as unknown as Parameters<typeof resolveConfig>[0];
    expect(resolveConfig(options, NOOP_DEPS).framework).toBe('webdriverio');
  });
});

describe('resolveConfig — platform', () => {
  it('is left to the capabilities unless set explicitly', () => {
    expect(resolveConfig({}, NOOP_DEPS).platform).toBeUndefined();
    expect(resolveConfig({ platform: 'ios' }, NOOP_DEPS).platform).toBe('ios');
  });
});

describe('resolveConfig — screenshots', () => {
  it('are on by default and can be turned off by option or environment', () => {
    expect(resolveConfig({}, NOOP_DEPS).screenshots).toBe(true);
    expect(resolveConfig({ screenshots: false }, NOOP_DEPS).screenshots).toBe(false);
    vi.stubEnv('QUALFLARE_SCREENSHOTS', 'false');
    expect(resolveConfig({}, NOOP_DEPS).screenshots).toBe(false);
  });
});

describe('resolveConfig — required-non-empty wire fields', () => {
  it('an explicit empty string falls back to the default', () => {
    const config = resolveConfig({ environment: '', language: '' }, NOOP_DEPS);
    expect(config.environment).toBe('development');
    expect(config.language).toBe('en-US');
  });
});
