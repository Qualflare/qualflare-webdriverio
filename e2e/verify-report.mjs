#!/usr/bin/env node
/**
 * Asserts that the dogfood run produced the report it was supposed to.
 *
 * This runs BEFORE the upload, deliberately. A reporter can lose a field and
 * still emit a plausible-looking report -- that is exactly how `Case.attempts`
 * went missing for three releases without anything turning red. The suite
 * passing proves the API did not throw; only reading the report proves it was
 * recorded.
 *
 * Exits non-zero with a specific message on the first failure.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const FRAMEWORK = 'webdriverio';
/** One report per spec file: WebdriverIO runs each in its own worker. */
const SPEC_FILES = 3;
const MASKED_SECRET = 'qf-dogfood-secret-value';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const outputDir = process.env.QUALFLARE_RESULTS_DIR ?? './e2e-results';

const failures = [];
const check = (label, ok, detail = '') => {
  if (!ok) failures.push(detail ? `${label} — ${detail}` : label);
};

if (!fs.existsSync(outputDir)) {
  console.error(`✗ ${outputDir} does not exist. Did the suite run?`);
  process.exit(1);
}
const reports = fs.readdirSync(outputDir).filter((f) => f.endsWith('.json'));
if (reports.length !== SPEC_FILES) {
  console.error(`✗ expected ${SPEC_FILES} reports in ${outputDir} (one per worker), found ${reports.length}`);
  process.exit(1);
}

const raws = reports.map((f) => fs.readFileSync(path.join(outputDir, f), 'utf8'));
const raw = raws.join('\n');
const parsed = raws.map((r) => JSON.parse(r));
const cases = parsed.flatMap((r) => (r.suites ?? []).flatMap((s) => s.cases ?? []));
const named = (name) => cases.find((c) => c.name.includes(name));

for (const report of parsed) {
  check('framework is correct', report.framework === FRAMEWORK, `got ${report.framework}`);
  check('metadata block present', !!report.metadata);
  check('metadata.runId stamped', !!report.metadata?.runId);
  check('platform derived from the capabilities', report.platform === 'web', `got ${report.platform}`);
}
// Never named *webdriver*: qf collect would route it to its Selenium parser.
for (const file of reports) {
  check('report named by UUID', /^[0-9a-f-]{36}\.json$/.test(file), file);
}

// -- one run, many workers ------------------------------------------------
// THE property that decides whether qf collect uploads every worker's results
// or silently keeps one: it merges only the files of the newest runId.
const runIds = new Set(parsed.map((r) => r.metadata?.runId));
check('every worker shares one runId', runIds.size === 1, [...runIds].join(', '));

check('four cases reported', cases.length === 4, `got ${cases.length}`);

// A red dogfood suite means the dogfood itself broke. Say so plainly rather
// than letting a downstream assertion fail confusingly.
const notPassed = cases.filter((c) => c.status !== 'passed');
check('every case passed', notPassed.length === 0, notPassed.map((c) => `${c.name}=${c.status}`).join(', '));

// -- metadata --------------------------------------------------------------
const meta = named('records the author-facing metadata API');
check('metadata case present', !!meta);
if (meta) {
  check('label recorded', meta.labels?.some((l) => l.name === 'team' && l.value === 'platform'));
  check('link recorded', meta.links?.some((l) => l.name === 'repository'));
  check('tag recorded', meta.tags?.includes('dogfood'));
  check('priority recorded', meta.priority === 'high');
  check('description recorded', !!meta.description);
  check('parameter recorded', meta.properties?.plan === 'enterprise');
}

// -- nested steps ----------------------------------------------------------
const steps = named('nests steps');
check('steps case present', !!steps);
if (steps) {
  const inner = steps.steps?.find((s) => s.name === 'inner');
  check('inner step recorded', !!inner);
  check('inner step is nested', inner?.parentIndex !== undefined, 'parentIndex missing');
}

// -- masked parameter ------------------------------------------------------
// Asserted over the WHOLE payload, not one field: redaction happens at source,
// so the only convincing proof is that the secret appears nowhere at all.
check('masked value never reaches the report', !raw.includes(MASKED_SECRET));

// -- screenshot travels out of band ---------------------------------------
const shotCase = named('attaches a screenshot');
check('screenshot case present', !!shotCase);
const shot = shotCase?.attachments?.find((a) => a.mimeType === 'image/png');
check('screenshot named', shot?.name === 'Screenshot', `got ${shot?.name}`);
check('screenshot attachment present', !!shot);
if (shot) {
  check('screenshot is not inlined', shot.content === undefined);
  check('screenshot has localImagePath', typeof shot.localImagePath === 'string');
  if (shot.localImagePath) {
    const shotPath = path.join(outputDir, shot.localImagePath);
    check('screenshot file exists on disk', fs.existsSync(shotPath), shotPath);
    if (fs.existsSync(shotPath)) {
      const head = fs.readFileSync(shotPath).subarray(0, 8);
      // A real PNG, not merely a filename ending in .png: the upload endpoint
      // cross-checks the extension against the MIME type it is handed.
      check('screenshot really is a PNG', head.equals(PNG_MAGIC));
      check('fileSize matches the file', shot.fileSize === fs.statSync(shotPath).size);
    }
  }
}

// -- per-attempt retry history --------------------------------------------
const flaky = named('fails once, then passes');
check('flaky case present', !!flaky);
if (flaky) {
  check('flaky case ended green', flaky.status === 'passed', `got ${flaky.status}`);
  check('isFlaky set', flaky.isFlaky === true);
  check('retryCount is 1', flaky.retryCount === 1, `got ${flaky.retryCount}`);
  check('two attempts recorded', flaky.attempts?.length === 2, `got ${flaky.attempts?.length}`);
  check(
    'attempts are [failed, passed]',
    JSON.stringify(flaky.attempts?.map((a) => a.status)) === '["failed","passed"]',
    JSON.stringify(flaky.attempts?.map((a) => a.status)),
  );
  check('first attempt kept its error', flaky.attempts?.[0]?.message === 'deliberate first-attempt failure');
  check('every attempt timed', flaky.attempts?.every((a) => typeof a.duration === 'number' && a.duration > 0));
  check(
    'first attempt\'s screenshot kept and labelled',
    JSON.stringify(flaky.attachments?.map((a) => a.name)) === '["Screenshot (attempt 1)"]',
    JSON.stringify(flaky.attachments?.map((a) => a.name)),
  );
}

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} assertion(s) failed against ${outputDir}:\n`);
  for (const f of failures) console.error(`    - ${f}`);
  console.error('');
  process.exit(1);
}
console.log(`✓ ${cases.length} cases across ${reports.length} workers verified, one runId — the reports match what the suite declared`);
