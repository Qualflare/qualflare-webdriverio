import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureRunId } from '../../src/run-id.js';
import { QualflareService, cleanStaleReports } from '../../src/service.js';
import { launcher } from '../../src/service-entry.js';
import * as mainEntry from '../../src/index.js';

// Every CI variable ci-detect reads, cleared so these tests behave the same on a
// laptop and on GitHub Actions (where GITHUB_RUN_ID would otherwise leak in).
function clearCiEnv(): void {
  for (const name of Object.keys(process.env)) {
    if (/^(CI|GITHUB_|GITLAB_|CI_|BUILDKITE|CIRCLE|JENKINS|TRAVIS|BITBUCKET|TF_BUILD|TEAMCITY|DRONE)/.test(name)) {
      vi.stubEnv(name, '');
    }
  }
}

beforeEach(() => {
  clearCiEnv();
  vi.stubEnv('QUALFLARE_RUN_ID', '');
  vi.stubEnv('WDIO_WORKER_ID', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.QUALFLARE_RUN_ID;
});

describe('QualflareService', () => {
  it('mints one runId in the launcher for the workers to inherit, and clears it on completion', () => {
    delete process.env.QUALFLARE_RUN_ID;
    const service = new QualflareService({ clean: false });
    service.onPrepare();
    const minted = process.env.QUALFLARE_RUN_ID;
    expect(minted).toMatch(/^[0-9a-f-]{36}$/);
    service.onComplete();
    expect(process.env.QUALFLARE_RUN_ID).toBeUndefined();
  });

  it('keeps a runId the user set, and does not clear it afterwards', () => {
    vi.stubEnv('QUALFLARE_RUN_ID', 'mine');
    const service = new QualflareService({ clean: false });
    service.onPrepare();
    service.onComplete();
    expect(process.env.QUALFLARE_RUN_ID).toBe('mine');
  });

  // Replacing a CI run id with a fresh UUID would split a sharded job, whose
  // machines share the provider's id, into one run per machine.
  it('leaves the CI provider\'s run id alone', () => {
    delete process.env.QUALFLARE_RUN_ID;
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    vi.stubEnv('GITHUB_RUN_ID', '424242');
    new QualflareService({ clean: false }).onPrepare();
    expect(process.env.QUALFLARE_RUN_ID).toBeUndefined();
  });
});

describe('the ./service entry', () => {
  // WebdriverIO constructs a string service entry's `launcher` in the launcher
  // and its `default` in every worker.
  it('exports a launcher and no default', async () => {
    expect(launcher).toBe(QualflareService);
    const entry = (await import('../../src/service-entry.js')) as Record<string, unknown>;
    expect(entry.default).toBeUndefined();
  });

  // A `launcher` on the main entry would make `services: ['@qualflare/webdriverio']`
  // construct the reporter (its default export) as a worker service.
  it('is the only entry with a launcher', () => {
    expect((mainEntry as Record<string, unknown>).launcher).toBeUndefined();
  });
});

describe('ensureRunId', () => {
  it('mints in the launcher, where WDIO_WORKER_ID is unset', () => {
    delete process.env.QUALFLARE_RUN_ID;
    const id = ensureRunId();
    expect(id).toBeTruthy();
    expect(process.env.QUALFLARE_RUN_ID).toBe(id);
  });

  // wdio.conf is evaluated again in every worker. Minting there would give each
  // worker its own id -- the exact failure this exists to prevent.
  it('never mints in a worker', () => {
    delete process.env.QUALFLARE_RUN_ID;
    vi.stubEnv('WDIO_WORKER_ID', '0-1');
    expect(ensureRunId()).toBeUndefined();
    expect(process.env.QUALFLARE_RUN_ID).toBeUndefined();
  });

  it('returns what the launcher set, in a worker', () => {
    vi.stubEnv('QUALFLARE_RUN_ID', 'from-launcher');
    vi.stubEnv('WDIO_WORKER_ID', '0-1');
    expect(ensureRunId()).toBe('from-launcher');
  });
});

describe('cleanStaleReports', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-wdio-clean-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const report = (runId: string, cliName = 'qualflare-webdriverio', image?: string) =>
    JSON.stringify({
      metadata: { cliName, runId },
      suites: [{ cases: [{ attachments: image ? [{ localImagePath: image }] : [] }] }],
    });

  it('removes this package\'s reports from other runs, and their screenshots', () => {
    fs.writeFileSync(path.join(dir, 'old.json'), report('run-1', undefined, 'shot.png'));
    fs.writeFileSync(path.join(dir, 'shot.png'), 'png');
    cleanStaleReports(dir, 'run-2');
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  // In CI two wdio invocations of one job share the provider's run id; the
  // second must not delete the first's results.
  it('keeps reports of the current run', () => {
    fs.writeFileSync(path.join(dir, 'same.json'), report('run-2'));
    cleanStaleReports(dir, 'run-2');
    expect(fs.readdirSync(dir)).toEqual(['same.json']);
  });

  it('never touches files another tool wrote', () => {
    fs.writeFileSync(path.join(dir, 'other.json'), report('run-1', 'qualflare-mocha'));
    fs.writeFileSync(path.join(dir, 'notes.json'), 'not json');
    fs.writeFileSync(path.join(dir, 'keep.png'), 'png');
    cleanStaleReports(dir, 'run-2');
    expect(fs.readdirSync(dir).sort()).toEqual(['keep.png', 'notes.json', 'other.json']);
  });

  it('cannot be pointed outside the directory by a crafted report', () => {
    const outside = path.join(os.tmpdir(), `qf-wdio-outside-${process.pid}.png`);
    fs.writeFileSync(outside, 'png');
    fs.writeFileSync(path.join(dir, 'evil.json'), report('run-1', undefined, outside));
    cleanStaleReports(dir, 'run-2');
    expect(fs.existsSync(outside)).toBe(true);
    fs.rmSync(outside);
  });

  it('is a no-op when the directory does not exist yet', () => {
    expect(() => cleanStaleReports(path.join(dir, 'missing'), 'run')).not.toThrow();
  });
});
