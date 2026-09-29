# @qualflare/webdriverio

[![npm version](https://img.shields.io/npm/v/%40qualflare%2Fwebdriverio.svg)](https://www.npmjs.com/package/@qualflare/webdriverio)
[![CI](https://github.com/Qualflare/qualflare-webdriverio/actions/workflows/ci.yml/badge.svg)](https://github.com/Qualflare/qualflare-webdriverio/actions/workflows/ci.yml)
[![Qualflare](https://api.qualflare.com/p/qualflare-webdriverio/badge.svg)](https://reports.qualflare.com/p/qualflare-webdriverio/launches)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)

A native WebdriverIO reporter for [Qualflare](https://qualflare.com), for web and
mobile runs alike. It captures results straight from your `wdio` run:
- status, plus per-attempt retry history with each attempt's own error and timing
- flakiness
- the screenshots WebdriverIO takes, attached to the test and attempt they belong to
- the browser or device each test ran on
- nested steps and author-facing metadata (labels, links, tags, priority, parameters)

Running Appium through WebdriverIO? Use
[`@qualflare/appium`](https://github.com/Qualflare/qualflare-appium). It is this
reporter with Appium's label, so your mobile runs show up as Appium in Qualflare.

The reporter itself makes **no network calls**. Each WebdriverIO worker writes a
report file, and [`qualflare-cli`](https://github.com/Qualflare/qualflare-cli)
merges them into one launch and uploads it.

## Install

```bash
npm install --save-dev @qualflare/webdriverio
```

Requires WebdriverIO **8 or 9** and Node `>=18.20`. Both are tested on every
change with a real run: two workers, headless Chrome, Mocha and Jasmine. You also
need [`@qualflare/cli`](https://github.com/Qualflare/qualflare-cli) v0.1.24 or
newer to upload screenshots.

## Setup

Add **both** the reporter and the service to `wdio.conf`:

```js
// wdio.conf.js
export const config = {
  // ...
  services: ['@qualflare/webdriverio/service'],
  reporters: ['spec', ['@qualflare/webdriverio', { environment: 'staging' }]],
};
```

Then upload after the run:

```bash
npx wdio run wdio.conf.js
qf <your-project> collect ./qualflare-results
```

### Why the service is not optional

WebdriverIO runs every spec file in its own worker process, and every worker
writes its own report. `qf collect` merges the files **of one run**, which it
recognizes by a shared `runId`. When it finds several runs, it keeps the newest
and ignores the rest.

On a laptop, each worker has nothing to derive a shared id from, so each would
invent its own. `qf collect` would then upload one spec file's results and exit
0. The service runs once, in the launcher, before any worker starts, and hands
every worker the same id. In CI it steps aside: the provider's run id (such as
`GITHUB_RUN_ID`) is already shared, including across the machines of a sharded
job.

It also removes this package's reports from **earlier** runs in
`./qualflare-results` before the run starts, so a stale file never rides along.
It never removes another tool's files or the current run's.

If the reporter ever falls back to an id of its own, every worker says so on
stderr.

Can't add a service? Call `ensureRunId()` at the top of `wdio.conf` instead:

```js
import { ensureRunId } from '@qualflare/webdriverio';
ensureRunId(); // before `export const config`
```

`wdio.conf` is evaluated in the launcher *and* again in every worker.
`ensureRunId()` mints the id only in the launcher, and the workers inherit it.

### Using the classes directly

```js
import QualflareReporter, { QualflareService } from '@qualflare/webdriverio';

export const config = {
  services: [[QualflareService, { resultsDir: './qualflare-results' }]],
  reporters: [[QualflareReporter, { resultsDir: './qualflare-results' }]],
};
```

If you change `resultsDir`, give the service the same value, so it cleans the
directory the workers write.

## What gets captured

| | |
|---|---|
| **Status** | passed, failed, skipped (`it.skip`, `xit`, pending). A test the worker ended under is `error`, never a pass |
| **Retries** | Mocha `this.retries(n)`: one case, every attempt with its own error, start time and duration; `isFlaky` when it passed on a retry |
| **Screenshots** | Every `browser.takeScreenshot()`, `saveScreenshot()` and element screenshot, attached to the test running (or just finished, for `afterTest`/`afterEach` hooks). A retried test keeps each attempt's screenshots, named by attempt |
| **Platform** | `web` for a browser, `ios`/`android` for an Appium session, `desktop` for the Mac2 and Windows drivers. Mobile Safari is `ios`, not `web` |
| **Device** | `platformName`, `platformVersion`, `deviceName`, `automationName`, `browserName` and `browserVersion` on every case |
| **Identity** | Each test's id includes the capability, so a suite run on Chrome and Firefox (or iOS and Android) keeps two histories instead of one merged one |

## Enriching your tests

```js
import { qualflare } from '@qualflare/webdriverio/runtime';

it('checks out', async () => {
  qualflare.label('owner', 'payments');
  qualflare.link('https://jira.example.com/PAY-12', { type: 'issue' });
  qualflare.parameter('card', '4242…', { masked: true });

  await qualflare.step('fill the form', async () => {
    await $('#card').setValue('4242 4242 4242 4242');
  });
});
```

The `/runtime` entry is only the metadata API, so it doesn't load the reporter.
No extra setup is needed: the reporter runs in the same process as your tests.
See [docs/METADATA-API.md](./docs/METADATA-API.md).

## Configuration

Every option also has an environment variable. See
[docs/CONFIGURATION.md](./docs/CONFIGURATION.md).

| Option | Default | |
|---|---|---|
| `resultsDir` | `./qualflare-results` | Where reports and screenshots go. **Not** `outputDir`, which WebdriverIO uses for its own logs |
| `environment` | `development` | Qualflare environment |
| `screenshots` | `true` | Attach the screenshots WebdriverIO takes |
| `platform` | from capabilities | Needed only for multiremote |
| `runId` | from the service or CI | See [Setup](#setup) |
| `enabled` | `true` | `false` makes the reporter a no-op |

## Known limitations

Cucumber is not supported yet. `specFileRetries` reports a re-run spec file as
duplicate cases. On WebdriverIO 8 with Jasmine, `afterTest` hooks are told a
failed spec passed. See [docs/LIMITATIONS.md](./docs/LIMITATIONS.md) for these
and the rest.

## Development

```bash
npm install
npm run build
npm test                  # unit
npm run test:built        # both module formats of every entry
npm run test:integration  # real WebdriverIO runs (needs Chrome)
npm run e2e               # the dogfood suite + report verifier
```

## License

Apache-2.0
