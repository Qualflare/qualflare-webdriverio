# Configuration

Options are the second element of the reporter's entry in `wdio.conf`:

```js
export const config = {
  services: ['@qualflare/webdriverio/service'],
  reporters: [['@qualflare/webdriverio', { environment: 'staging', resultsDir: './qualflare-results' }]],
};
```

WebdriverIO merges keys of its own into this object before constructing the
reporter (`logFile`, `writeStream`, and `outputDir` if you set it), so unknown
keys are ignored rather than rejected.

**Precedence, highest first:** the option you pass → `QUALFLARE_*` → `QF_*` (a compat alias with the
Go CLI, where one exists) → auto-detection (branch/commit/CI/shard only) → a hardcoded default.

There is **no `token` option**. This reporter makes no network calls, so it has no credential —
`qf login` holds it instead.

> This table reflects the actual option set in `src/config/resolve-config.ts`. If the two ever
> drift, regenerate it from that file, not from memory.

| Option | Env var(s) | Default | Notes |
|---|---|---|---|
| `resultsDir` | `QUALFLARE_RESULTS_DIR` → `QUALFLARE_OUTPUT_DIR` | `./qualflare-results` | Where every worker writes its report and screenshots. Each file is named by a fresh UUID, so workers never collide. **Not `outputDir`**: WebdriverIO reads a reporter option of that name as the directory for the reporter's own log file. If you change it, pass the same value to the service. |
| `runId` | `QUALFLARE_RUN_ID` | the service's, else the CI run id, else derived from the `wdio run` launcher process | Identifies the run a report belongs to. `qf collect` merges only the newest run's files, so every worker must agree. Inside CI the provider's run id is shared; outside it, every worker derives the same id from the launcher process (its pid and start time), on Linux, macOS and Windows. Set it yourself, or add the service, only when a programmatic `Launcher` runs WebdriverIO more than once in one process. If a worker falls back to a random id, it warns. |
| `screenshots` | `QUALFLARE_SCREENSHOTS` | `true` | Attach the screenshots WebdriverIO takes (`takeScreenshot`, `saveScreenshot`, element screenshots). |
| `platform` | — | from capabilities | One of `android`, `ios`, `desktop`, `web`, `api`. Derived per worker: `platformName` iOS/Android first, then a browser means `web`, then the Mac2/Windows drivers mean `desktop`. Left unset (never guessed) for multiremote. |
| `browser` | — | from capabilities | The session's `browserName`. |
| `shardIndex` | `QUALFLARE_SHARD_INDEX` | from `--shard` | 0-based shard position stamped on every case. WebdriverIO's `--shard 2/3` is 1-based and is converted. An attribution label only. |
| `enabled` | `QUALFLARE_ENABLED` | `true` | `false` makes the reporter a complete no-op. |
| `environment` | `QUALFLARE_ENVIRONMENT` → `QF_ENVIRONMENT` | `development` | **The environment's uid (slug), not its display name**; see below. An explicit `''` falls back to the default. |
| `language` | `QUALFLARE_LANGUAGE` → `QF_LANGUAGE` | `en-US` | Same non-empty treatment. |
| `milestone` | `QUALFLARE_MILESTONE` → `QF_MILESTONE` | `null` | A value `< 1` normalizes to `null`. |
| `branch` | `QUALFLARE_BRANCH` → `QF_BRANCH` | auto-detected, else `null` | An explicit `null` means "do not auto-detect" and skips the `git` subprocess. |
| `commit` | `QUALFLARE_COMMIT` → `QF_COMMIT` | auto-detected, else `null` | Same. |
| `os` | — | `os.type() os.release()` | The machine running the workers. |
| `properties` | — | unset | Arbitrary `Record<string, string>` attached to the launch. |
| `ciProvider`, `ciBuildNumber`, `ciRunUrl`, `ciPrNumber` | — | auto-detected | Each can be overridden independently. |
| `maxAttachmentBytes` | `QUALFLARE_MAX_ATTACHMENT_BYTES` | `5000000` (5MB) | Per-attachment cap; anything larger is skipped with a warning, not truncated. |
| `maxTotalAttachmentBytes` | `QUALFLARE_MAX_TOTAL_ATTACHMENT_BYTES` | `10000000` (10MB) | Per-worker budget for **inlined** attachments (text, logs, JSON from `qualflare.attachment()`). Screenshots are written to `resultsDir` and do not spend it. |
| `debug` | `QUALFLARE_DEBUG` → `QF_DEBUG` | `false` | Extra detail on stderr. |

The framework label is not an option: this package always reports
`webdriverio`, and [`@qualflare/appium`](https://github.com/Qualflare/qualflare-appium)
reports `appium`.

## The service's options

| Option | Default | |
|---|---|---|
| `resultsDir` | same as the reporter | The directory to clean. Must match the reporter's. |
| `clean` | `true` | Before the run, delete this package's reports from **earlier** runs, and the screenshots they reference. Reports are recognized by content (`metadata.cliName`), never by filename, and the current run's reports are kept. That matters in CI, where two `wdio` invocations of one job share a run id. |

## `environment` is matched by uid, not display name

The server resolves this value against the environment's **uid** (its slug), not the name shown in
the UI:

```sql
SELECT * FROM environments WHERE project_id = $1 AND uid = $2;
```

So an environment displayed as **Staging** is almost certainly `staging` here. Passing the display
name verbatim is the common mistake, and it does not fail at test time — the reporter has no
network access and cannot know the value is wrong, so the run completes and writes a perfectly
valid report. It fails later, when `qualflare-cli collect` uploads it and the lookup misses:

```
environment 'Staging' not found   (404)
```

If `collect` 404s on an environment you can plainly see in the UI, check the uid on the project's
environment settings page and use that.

## CI metadata auto-detection

Provider, build number, run URL and PR number are detected for GitHub Actions, GitLab CI, CircleCI,
Buildkite, Jenkins, Azure Pipelines and Bitbucket Pipelines. Each field can be overridden
independently — setting `ciBuildNumber` by hand leaves the other three auto-detected.
