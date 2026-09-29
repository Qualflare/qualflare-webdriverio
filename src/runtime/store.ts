/**
 * The in-memory channel between a test body and the reporter.
 *
 * In WebdriverIO the reporter is constructed INSIDE the worker process that runs
 * the tests, so a `qualflare.label()` call and the reporter share a process and
 * need no file or IPC between them — unlike the Mocha sibling, whose `--parallel`
 * mode forces a file channel. Measured: `onTestStart` fires before the test
 * body, and the body read the uid the reporter had just set.
 *
 * WHY `globalThis` AND NOT A MODULE-LEVEL VARIABLE
 *
 * The reporter is loaded by WebdriverIO, while the test file imports
 * `@qualflare/webdriverio/runtime` itself. Those can resolve to different builds
 * (ESM and CJS) and so to two module instances with two module scopes. A
 * module-level variable would be written in one and read as empty in the other,
 * silently. `Symbol.for` is the cross-realm registry, so both instances reach
 * the same object. Never replace this with a module-level variable.
 */
import { logger } from '../shared/logger.js';
import type { RuntimeMessage } from './message-types.js';

const STORE_KEY = Symbol.for('qualflare.webdriverio.runtime');

interface RuntimeStore {
  /** The uid of the test that `qualflare.*()` calls belong to, or null. */
  current: string | null;
  messages: Map<string, RuntimeMessage[]>;
  warnedOrphan: boolean;
}

type GlobalWithStore = typeof globalThis & { [STORE_KEY]?: RuntimeStore };

function store(): RuntimeStore {
  const g = globalThis as GlobalWithStore;
  let s = g[STORE_KEY];
  if (!s) {
    s = { current: null, messages: new Map(), warnedOrphan: false };
    g[STORE_KEY] = s;
  }
  return s;
}

/** Appends one message to the current test. A call with no current test is
 * dropped, with one warning per worker: attributing it to whichever test is
 * nearby would be worse than losing it. */
export function emit(message: RuntimeMessage): void {
  const s = store();
  if (s.current === null) {
    if (!s.warnedOrphan) {
      s.warnedOrphan = true;
      logger.warn(
        'a qualflare.*() call was made outside a test (or @qualflare/webdriverio is not in `reporters`); it was dropped.',
      );
    }
    return;
  }
  const list = s.messages.get(s.current);
  if (list) {
    list.push(message);
  } else {
    s.messages.set(s.current, [message]);
  }
}

/** Called by the reporter when a test (or a retry of it) starts. */
export function beginTest(uid: string): void {
  const s = store();
  s.current = uid;
  s.messages.set(uid, []);
}

/** Detaches the current test, so later calls are dropped rather than
 * misattributed. */
export function endCurrentTest(): void {
  store().current = null;
}

/** The uid calls are currently attributed to. */
export function currentTestUid(): string | null {
  return store().current;
}

/** Removes and returns everything recorded for `uid`. */
export function takeMessages(uid: string): RuntimeMessage[] {
  const s = store();
  const list = s.messages.get(uid) ?? [];
  s.messages.delete(uid);
  return list;
}
