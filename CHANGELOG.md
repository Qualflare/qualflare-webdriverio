# Changelog

## 0.1.0 — 2026-10-03

Initial release.

- The reporter: `reporters: ['@qualflare/webdriverio']`. One report per worker,
  named by UUID, merged by `qf collect`. Works on WebdriverIO 8 and 9, with Mocha
  and Jasmine.
- `QualflareService` (and `@qualflare/webdriverio/service` for the string form).
  It gives every worker one runId, which `qf collect` needs to merge them, and
  cleans this package's reports from earlier runs. `ensureRunId()` does the
  first half for configurations without a service.
- Per-attempt retry history for Mocha retries, with each attempt's own error,
  start time and duration.
- WebdriverIO's screenshots attached to the test and attempt they were taken
  for, including from `afterTest`/`afterEach`.
- Platform derived from the session's capabilities: `ios`/`android` for Appium,
  `web` for a browser, `desktop` for Mac2/Windows, and unset for multiremote.
  Device and browser capabilities are recorded on every case.
- `qualflare.*()` metadata API, also at `@qualflare/webdriverio/runtime`.

Reports are labelled `webdriverio`. Until qualflare-cli recognizes that label,
`qf collect` uploads them under the category `generic`.
