# Known limitations

Each of these was measured, not assumed. If one bites you, the workaround is
listed with it.

## Cucumber is not supported yet

WebdriverIO's Cucumber adapter reports scenarios as suites and Gherkin steps as
tests. Through this reporter, every step would become its own test case. The
reporter warns when it sees `framework: 'cucumber'`. Mocha and Jasmine are
supported, and both are tested on every change.

## `specFileRetries` reports a re-run spec file twice

`specFileRetries` re-runs a whole failed spec file in a **new worker** with the
same runId. Both workers write a report, and `qf collect` merges them, so every
test in that file appears twice: once failed, once passed.

Per-test retries (`this.retries(n)` in Mocha) don't have this problem. They are
recorded as the attempts of one case, which is what Qualflare's flakiness
tracking is built on. Prefer them.

## Programmatic runs in one process need the service

`qf collect` merges only the newest run's files, so every worker of one run has
to agree on a run id. Without the service, each worker derives it from the
`wdio run` launcher process (its pid and start time), which is the same for
every worker of a run and new for the next run.

The exception is a programmatic `Launcher` started more than once inside one
Node process. Those runs share the process, so they derive the same id, and a
later run would be merged with an earlier one. Add the service there: it sets
a fresh id when each run starts and clears it when the run completes. (Not
`ensureRunId()`, which sets the id once per process.) See the README's
[Setup](../README.md#setup). A worker that has to fall back to a random id says
so on stderr.

## On WebdriverIO 8 with Jasmine, `afterTest` is told a failed spec passed

WebdriverIO 8 calls `afterTest` with `passed: true` for a Jasmine spec whose
expectation failed. So a screenshot-on-failure hook written as
`if (!passed) takeScreenshot()` never takes one there.

This is WebdriverIO's behaviour, and this reporter attaches every screenshot it
is given. On WebdriverIO 9, or with Mocha, the hook works. On 8 with Jasmine,
take the screenshot unconditionally in `afterTest`.

## Multiremote has no platform

A multiremote session is several browsers or devices at once, so no single
platform is true of it, and the reporter leaves `platform` unset rather than
guessing. Pass `platform` explicitly, or `--platform` to `qf collect`.

The capability part of each test's id is `multiremote`.

## Only the final attempt's metadata is kept, but every attempt's screenshots are

For a retried test, the labels, tags, steps and parameters of superseded
attempts are discarded, as across the Qualflare reporter family.

Screenshots are deliberately kept from every attempt, named
`Screenshot (attempt 1)` and so on. A flaky test's failure screenshot is the most
useful evidence it leaves behind, and the wire format has no per-attempt
attachments to carry it anywhere else.

## Metadata and screenshots outside a test are dropped

A `qualflare.*()` call or screenshot in a `before`/`after` (all) hook, or at
module load, belongs to no single test. It is dropped: one warning per worker for
metadata, silently for screenshots. Calls in `afterTest` and `afterEach` belong
to the test that just finished.

## Changing a test's capability starts a new history

Each test's id ends in its capability (`@chrome`, `@ios-safari`, `@android`), so
Chrome and Firefox results never merge. The key is coarse on purpose. It
excludes versions and device models, so moving to a newer simulator keeps the
history. Moving a suite from Chrome to Firefox starts a new one.

## Per-case output is not captured

WebdriverIO gives a reporter no captured stdout/stderr per test.

## Caps

Per case: 50 attachments, 100 labels, 20 links, 64 tags, and 300 steps per
attempt. Per suite (spec file): 5,000 cases. These mirror the server's own limits,
so a report is trimmed rather than rejected.

## Screenshots need `@qualflare/cli` v0.1.24+

Screenshots are written beside the report and referenced by `localImagePath`.
Older CLIs record them from their name alone, as placeholders nobody can
download.
