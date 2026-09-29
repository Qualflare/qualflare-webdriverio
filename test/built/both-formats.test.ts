import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

/** Loads the BUILT package, every entry in both formats.
 *
 * Separate from test/unit because it needs `dist`, and because the reporter
 * family has shipped a bug that every other check passed: the unit tests import
 * `src` and never see a bundler's interop, and an ESM smoke test worked while
 * `require()` of the CJS build threw "Class extends value #<Object> is not a
 * constructor". This package's base class comes from @wdio/reporter, the exact
 * shape of that bug. Shipping two formats means testing two formats.
 */

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../..');
const dist = path.join(root, 'dist');

beforeAll(() => {
  if (!fs.existsSync(dist)) {
    throw new Error(`dist/ is missing — run \`npm run build\` before this suite (looked in ${dist})`);
  }
});

type ReporterCtor = new (options: Record<string, unknown>) => { emit: unknown; isSynchronised: unknown };

function assertReporter(Reporter: unknown, label: string): void {
  expect(typeof Reporter, `${label}: the default export must be a constructor`).toBe('function');
  // WDIOReporter's constructor opens a log file unless handed a stream.
  const instance = new (Reporter as ReporterCtor)({ enabled: false, writeStream: { write: () => true } });
  // All @wdio/runner uses: emit() to deliver events, isSynchronised to wait.
  expect(typeof instance.emit, `${label}: emit`).toBe('function');
  expect(instance.isSynchronised, `${label}: isSynchronised`).toBe(true);
}

describe('the built package', () => {
  it('main entry, ESM: the default export is the reporter, as WebdriverIO loads it by name', async () => {
    const esm = (await import(path.join(dist, 'index.js'))) as Record<string, unknown>;
    assertReporter(esm.default, 'ESM');
    expect(typeof esm.QualflareService).toBe('function');
    expect(typeof esm.ensureRunId).toBe('function');
    expect(typeof (esm.qualflare as { label?: unknown }).label).toBe('function');
    expect(esm.launcher, 'a launcher here would make WDIO construct the reporter as a service').toBeUndefined();
  });

  it('main entry, CJS: loads under require(), the way a CommonJS wdio.conf does', () => {
    const cjs = require(path.join(dist, 'index.cjs')) as Record<string, unknown>;
    assertReporter(cjs.default ?? cjs.QualflareWebdriverioReporter, 'CJS');
    assertReporter(cjs.QualflareWebdriverioReporter, 'CJS named');
    expect(typeof cjs.QualflareService).toBe('function');
    expect(cjs.launcher).toBeUndefined();
  });

  it('./service exposes a launcher and no default, in both formats', async () => {
    const esm = (await import(path.join(dist, 'service.js'))) as Record<string, unknown>;
    const cjs = require(path.join(dist, 'service.cjs')) as Record<string, unknown>;
    for (const [label, mod] of [['ESM', esm], ['CJS', cjs]] as const) {
      expect(typeof mod.launcher, `${label}: launcher`).toBe('function');
      expect(mod.default, `${label}: a default would be constructed in every worker`).toBeUndefined();
    }
  });

  it('./runtime exposes qualflare in both formats, and never loads @wdio/reporter', async () => {
    const esm = (await import(path.join(dist, 'runtime.js'))) as Record<string, unknown>;
    const cjs = require(path.join(dist, 'runtime.cjs')) as Record<string, unknown>;
    for (const mod of [esm, cjs]) {
      expect(typeof (mod.qualflare as { step?: unknown }).step).toBe('function');
    }
    for (const file of ['runtime.js', 'runtime.cjs']) {
      expect(fs.readFileSync(path.join(dist, file), 'utf8')).not.toContain('@wdio/');
    }
  });

  // The two builds are two module instances. Metadata recorded through one must
  // reach a reporter loaded from the other, or it is dropped without a sound.
  it('shares runtime state across the ESM and CJS builds', async () => {
    const key = Symbol.for('qualflare.webdriverio.runtime');
    const esm = (await import(path.join(dist, 'runtime.js'))) as { qualflare: { label: (n: string, v: string) => void } };
    const store = () => (globalThis as Record<symbol, { current: string | null; messages: Map<string, unknown[]> }>)[key];
    esm.qualflare.label('probe', 'x'); // creates the store; no current test, so dropped
    store()!.current = 'uid-1';
    store()!.messages.set('uid-1', []);
    const cjs = require(path.join(dist, 'runtime.cjs')) as { qualflare: { label: (n: string, v: string) => void } };
    cjs.qualflare.label('from', 'cjs');
    expect(store()!.messages.get('uid-1')).toEqual([{ type: 'label', name: 'from', value: 'cjs' }]);
    store()!.current = null;
  });
});
