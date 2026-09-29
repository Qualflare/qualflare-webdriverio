# Metadata API

`qualflare` is the author-facing runtime API: labels, links, tags, priority,
parameters, attachments and steps, recorded against the test that is running.

```js
import { qualflare } from '@qualflare/webdriverio/runtime';
```

`@qualflare/webdriverio/runtime` is the API alone, without the reporter or
`@wdio/reporter` behind it. The main entry exports the same `qualflare` object.

## Which test a call belongs to

A call attaches to the test that is running. A test also keeps what arrives after
its verdict and before the next test starts, which covers WebdriverIO's
`afterTest` hook and Mocha's `afterEach`. Those hooks are where
screenshot-on-failure code usually lives.

A call made anywhere else is dropped with one warning per worker:
- at module load
- in a `before`/`after` (all) hook
- after the last test of a suite

Such a call belongs to no single test, and attributing it to whichever test was
nearby would be worse than losing it.

For a retried test, only the **final** attempt's metadata is kept, as across the
Qualflare reporter family. Screenshots are the exception (see the README).

## How it works

WebdriverIO constructs the reporter inside each worker, the same process that
runs that worker's tests. So a `qualflare.*()` call and the reporter need no file
or IPC between them: the reporter marks the running test when WebdriverIO reports
it started, and each call appends to that test's list in memory.

That state lives on `globalThis` under a `Symbol.for` key, not in a module
variable. The reporter is loaded by WebdriverIO, while your spec imports
`/runtime` itself. The two can resolve to different builds (ESM and CJS), each
with its own module scope. A module variable would be written in one and read as
empty in the other, silently. The symbol registry is shared, so both reach the
same state. `test/built/both-formats.test.ts` asserts exactly that.

## `qualflare.label(name, value)`

Arbitrary name/value metadata. This is how Allure-style `epic`/`feature`/`story`/`owner`/`severity`
are expressed.

```ts
qualflare.label('epic', 'Billing');
qualflare.label('owner', 'payments-team');
```

Capped at 100 labels per case (the server's limit); further labels are dropped.

**Requires `@qualflare/cli >= v0.1.18`.** Earlier CLI versions parsed the report but silently
discarded `labels` and `links`, so they never reached the server.

## `qualflare.link(url, opts?)`

A typed external reference.

```ts
qualflare.link('https://tracker.example/QF-42', { type: 'issue', name: 'QF-42' });
qualflare.link('https://wiki.example/runbook');            // type defaults to 'custom'
```

`opts.type` is `'issue' | 'tms' | 'custom'`. Capped at 20 links per case.

## `qualflare.tag(...tags)`

```ts
qualflare.tag('smoke');
qualflare.tag('billing', 'regression');
```

Duplicates are removed. Capped at 64 tags per case, each truncated to 255 characters.

## `qualflare.description(text)`

```ts
qualflare.description('Signs a user in and asserts the greeting renders.');
```

Markdown. Last call wins within a test.

## `qualflare.priority(value)`

```ts
qualflare.priority('high');
```

One of `'low' | 'medium' | 'high' | 'critical'`. Last call wins.

## `qualflare.parameter(name, value?, opts?)`

Records a named input.

```ts
qualflare.parameter('sku', 'BOOK-1');
qualflare.parameter('password', secret, { masked: true });
```

**Placement matters.** Inside an open `qualflare.step()`, the parameter attaches to that step.
Outside any step it becomes a `Case.properties` entry instead, because the wire contract has no
case-level `Parameter[]`.

`masked` **redacts the value before the report is written.** The secret never leaves this process:
it is not stored server-side and cannot be read back through the API. Inside a step the parameter
travels as `{ name, masked: true }` with no value and the UI renders `••••••` from the flag; outside
one it lands in `Case.properties`, a flat map with nowhere for the flag, so the value itself becomes
`••••••`.

A masked value is therefore **unrecoverable** — that is the point, but it is not a display toggle you
can undo later.

Requires v0.3.0 or newer of this package. Before that, `masked` was a display hint only: the real value
was sent, stored in plaintext and readable through the API, while only the UI drew dots over it.

## `qualflare.attachment(name, content, opts?)`

Attach in-memory content.

```ts
qualflare.attachment('request', JSON.stringify(body), { mimeType: 'application/json' });
qualflare.attachment('thumbnail', pngBase64, { encoding: 'base64', mimeType: 'image/png' });
```

`opts.encoding` is `'utf8'` (default) or `'base64'`. Subject to the same size caps as any other
inline attachment — see [`CONFIGURATION.md`](./CONFIGURATION.md).

## `qualflare.attachmentFromFile(name, path, opts?)`

Attach a file from disk, read at report time.

```ts
qualflare.attachmentFromFile('har', 'artifacts/session.har', { mimeType: 'application/json' });
```

An unreadable path is skipped with a warning rather than failing the test.

## `qualflare.step(name, fn)`

Records a named step around `fn`, capturing its duration and whether it threw.

```ts
await qualflare.step('add an item to the cart', async () => {
  qualflare.parameter('sku', 'BOOK-1');
  expect(cart.items).toHaveLength(1);
});
```

Always `await` it — it returns a promise resolving to whatever `fn` returns, and a rejection is
re-thrown after the failure is recorded, so control flow is unchanged.

WebdriverIO has no step API of its own, so this is the only way to get step
structure into a report. The step exists in Qualflare only, not in the spec
reporter's terminal output.

Timing is exact: real elapsed time around the awaited body, not an approximation.

Steps nest, and nesting is preserved in the report via `parentIndex`. A single test may record at
most 300 steps; past that they are dropped with a warning rather than risking the server rejecting
the whole case.

## Attachments and WebdriverIO's own screenshots

You don't need `qualflare.attachment()` for screenshots. Every screenshot
WebdriverIO takes is picked up from its command stream and attached
automatically, and `screenshots: false` turns that off. Use the API for anything
else: a HAR, a log excerpt, a JSON response.

Images (`image/png`, `image/jpeg`, `image/gif`) are written into `resultsDir` and
referenced by `localImagePath`, so they never travel base64-inlined inside the
upload body. Everything else is inlined, bounded by `maxAttachmentBytes` and the
per-worker budget.
