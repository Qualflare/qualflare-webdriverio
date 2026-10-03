import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Case, Collect } from '../../src/shared/types.js';

/**
 * Drives a REAL WebdriverIO run -- local runner, two workers, headless Chrome --
 * against the fixture project and asserts the reports it wrote.
 *
 * The fixture names the package in both string forms, which WebdriverIO resolves
 * from inside @wdio/utils. So the package has to be installed under its own
 * name: `node_modules/@qualflare/webdriverio` is linked to this repository, and
 * what loads is the built dist/ through the real exports map. `npm run build`
 * is a prerequisite; a broken exports map fails here rather than after
 * publishing.
 *
 * WDIO_VERSION_UNDER_TEST, when set, is the WebdriverIO major the CI matrix
 * installed; the assertions are the same for 8 and 9.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const fixtureDir = path.join(here, 'fixtures/wdio-project');

/** Every run's results directory, removed once the suite is done. */
const runDirs: string[] = [];

beforeAll(() => {
  if (!fs.existsSync(path.join(repoRoot, 'dist/index.js'))) {
    throw new Error('dist/ is missing: run `npm run build` before the integration suite.');
  }
  const link = path.join(repoRoot, 'node_modules/@qualflare/webdriverio');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.rmSync(link, { recursive: true, force: true });
  // A junction on Windows: a directory symlink there needs admin rights.
  fs.symlinkSync(process.platform === 'win32' ? repoRoot : '../..', link, process.platform === 'win32' ? 'junction' : 'dir');
});

afterAll(() => {
  for (const dir of runDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** `reject: false` because the fixture fails on purpose; the assertions are
 * about the written reports, never the exit code. */
async function runFixture(
  framework: 'mocha' | 'jasmine',
  configFile = 'wdio.conf.mjs',
): Promise<{ reports: Collect[]; files: string[]; resultsDir: string }> {
  const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualflare-wdio-integration-'));
  runDirs.push(resultsDir);
  const env: Record<string, string | undefined> = {
    ...process.env,
    FIXTURE_FRAMEWORK: framework,
    QUALFLARE_RESULTS_DIR: resultsDir,
  };
  // The service must be what makes the workers agree, so nothing may hand
  // them a shared id from outside: no QUALFLARE_RUN_ID and no CI run id.
  for (const name of Object.keys(env)) {
    if (name === 'QUALFLARE_RUN_ID' || name === 'CI' || /^(GITHUB_|GITLAB_|CI_|BUILDKITE|CIRCLE|JENKINS|TF_BUILD|BITBUCKET)/.test(name)) {
      delete env[name];
    }
  }
  // extendEnv: false, or execa merges process.env back in and the deletions
  // above do nothing -- on GitHub Actions the workers then share
  // GITHUB_RUN_ID, which is correct behaviour but not what this asserts.
  const result = await execa('npx', ['wdio', 'run', configFile], {
    cwd: fixtureDir,
    env,
    extendEnv: false,
    // npx is a .cmd shim on Windows, which only a shell can run.
    shell: process.platform === 'win32',
    reject: false,
  });

  const files = fs.readdirSync(resultsDir);
  const reports = files
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(resultsDir, f), 'utf8')) as Collect);
  if (reports.length === 0) {
    throw new Error(
      `no report in ${resultsDir}. exit=${result.exitCode}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
    );
  }
  return { reports, files, resultsDir };
}

const allCases = (reports: Collect[]): Case[] => reports.flatMap((r) => r.suites.flatMap((s) => s.cases));
const caseNamed = (reports: Collect[], name: string): Case => {
  const found = allCases(reports).find((c) => c.name === name);
  if (!found) {
    throw new Error(`no case named "${name}". Have: ${allCases(reports).map((c) => c.name).join(' | ')}`);
  }
  return found;
};

describe('@qualflare/webdriverio against a real WebdriverIO run', () => {
  describe('mocha', () => {
    let reports: Collect[];
    let files: string[];
    let resultsDir: string;

    beforeAll(async () => {
      // One run shared by the assertions below: a WebdriverIO run with a
      // browser is far too slow to repeat per assertion.
      ({ reports, files, resultsDir } = await runFixture('mocha'));
    });

    // THE property this package exists to get right. qf collect keeps only the
    // newest run it finds; per-worker ids would upload one spec file's results.
    it('writes one report per worker, all sharing the runId the service minted', () => {
      expect(reports).toHaveLength(2);
      const runIds = new Set(reports.map((r) => r.metadata.runId));
      expect(runIds.size).toBe(1);
      expect([...runIds][0]).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('writes reports the CLI identifies as qualflare-json, never by a *webdriver* filename', () => {
      for (const report of reports) {
        expect(report.framework).toBe('webdriverio');
        expect(report.metadata.cliName).toBe('qualflare-webdriverio');
        expect(report).not.toHaveProperty('config');
        expect(report.platform).toBe('web');
        expect(report.browser).toBe('chrome');
        expect(report.environment).toBe('fixture');
      }
      for (const file of files.filter((f) => f.endsWith('.json'))) {
        expect(file).toMatch(/^[0-9a-f-]{36}\.json$/);
      }
    });

    it('maps statuses and names tests by their describe chain', () => {
      expect(caseNamed(reports, 'Basics passes with metadata').status).toBe('passed');
      expect(caseNamed(reports, 'Basics is skipped').status).toBe('skipped');
      expect(caseNamed(reports, 'Basics nested keeps its describe chain').status).toBe('passed');
      const failed = caseNamed(reports, 'Basics fails on purpose');
      expect(failed.status).toBe('failed');
      expect(failed.error).toContain('to have text');
      expect(failed.id).toBe('specs/basics.spec.mjs#Basics fails on purpose@chrome');
    });

    it('groups a Mocha retry into one flaky case with both attempts', () => {
      const flaky = caseNamed(reports, 'Flaky passes on the second attempt');
      expect(flaky.status).toBe('passed');
      expect(flaky.isFlaky).toBe(true);
      expect(flaky.attempts?.map((a) => a.status)).toEqual(['failed', 'passed']);
      expect(flaky.attempts?.[0]?.message).toBe('first attempt fails');
      expect(allCases(reports).filter((c) => c.name === flaky.name)).toHaveLength(1);
    });

    it('attaches the afterTest screenshot to the test and attempt it was taken for', () => {
      const failed = caseNamed(reports, 'Basics fails on purpose');
      expect(failed.attachments?.map((a) => a.name)).toEqual(['Screenshot']);
      const flaky = caseNamed(reports, 'Flaky passes on the second attempt');
      expect(flaky.attachments?.map((a) => a.name)).toEqual(['Screenshot (attempt 1)']);
      for (const attachment of [...failed.attachments!, ...flaky.attachments!]) {
        expect(attachment.mimeType).toBe('image/png');
        const bytes = fs.readFileSync(path.join(resultsDir, attachment.localImagePath!));
        expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
      }
      expect(caseNamed(reports, 'Basics passes with metadata').attachments).toBeUndefined();
    });

    it('records qualflare.*() metadata from @qualflare/webdriverio/runtime, masking what was masked', () => {
      const withMeta = caseNamed(reports, 'Basics passes with metadata');
      expect(withMeta.labels).toEqual([{ name: 'owner', value: 'fixtures' }]);
      expect(withMeta.steps?.map((s) => [s.name, s.status])).toEqual([['open the page', 'passed']]);
      expect(withMeta.properties?.password).toBe('••••••');
      const raw = fs
        .readdirSync(resultsDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => fs.readFileSync(path.join(resultsDir, f), 'utf8'))
        .join('');
      expect(raw).not.toContain('hunter2');
    });

    it('records the browser capabilities on every case', () => {
      for (const testCase of allCases(reports)) {
        expect(testCase.properties?.browserName).toBe('chrome');
        expect(testCase.properties?.browserVersion).toMatch(/^\d+\./);
      }
    });
  });

  // What a wizard-generated config looks like: the reporter, no service. The
  // workers derive one run id from the shared launcher process instead.
  describe('without the service', () => {
    it('still gives every worker one run id, derived from the launcher', async () => {
      const first = await runFixture('mocha', 'wdio.noservice.conf.mjs');
      const second = await runFixture('mocha', 'wdio.noservice.conf.mjs');
      for (const { reports } of [first, second]) {
        expect(reports).toHaveLength(2);
        const ids = new Set(reports.map((r) => r.metadata.runId));
        expect(ids.size).toBe(1);
        expect([...ids][0]).toMatch(/^launch-[0-9a-f]{32}$/);
      }
      // A new `wdio run` is a new launcher process, so a new run.
      expect(first.reports[0]!.metadata.runId).not.toBe(second.reports[0]!.metadata.runId);
    });
  });

  describe('jasmine', () => {
    it('reports passed, failed and pending specs', async () => {
      const { reports } = await runFixture('jasmine');
      expect(caseNamed(reports, 'Jasmine basics passes').status).toBe('passed');
      const failed = caseNamed(reports, 'Jasmine basics fails on purpose');
      expect(failed.status).toBe('failed');
      // Jasmine pads its messages with trailing whitespace; they are trimmed.
      expect(failed.error).toMatch(/^Expected 1 to be 2\./);
      expect(failed.error).toBe(failed.error!.trim());
      // One from the spec body; WebdriverIO 9 adds a second from wdio.conf's
      // on-failure afterTest, which WebdriverIO 8 never fires under Jasmine.
      const names = failed.attachments?.map((a) => a.name) ?? [];
      expect(names.length).toBeGreaterThanOrEqual(1);
      for (const name of names) {
        expect(name).toMatch(/^Screenshot( \d+)?$/);
      }
      expect(caseNamed(reports, 'Jasmine basics is pending').status).toBe('skipped');
    });
  });
});
