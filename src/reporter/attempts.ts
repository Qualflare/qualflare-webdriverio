/**
 * Per-attempt retry history.
 *
 * With Mocha's `retries`, WebdriverIO reports a failed attempt as `onTestRetry`
 * and sends NO `onTestEnd` for it; the next attempt then starts with a FRESH uid
 * and `retries` counting the attempts before it. Measured on WDIO 9, so attempts
 * are grouped by the test's identity (file + title chain + capability), never by
 * uid, which changes on every attempt.
 *
 * Each attempt is its own stats object with its own start time and duration, so
 * unlike the Mocha sibling every attempt carries real timing, not only the last.
 */
import {
  MAX_ATTEMPTS_PER_CASE,
  MAX_ATTEMPT_MESSAGE_RUNES,
  MAX_ATTEMPT_TRACE_RUNES,
} from '../shared/constants.js';
import { msToNs } from '../shared/duration.js';
import { truncateRunes } from '../shared/text.js';
import type { Attempt, CaseStatus } from '../shared/types.js';

/** One finished execution of a test. */
export interface RecordedAttempt {
  status: CaseStatus;
  message?: string;
  trace?: string;
  /** Milliseconds, as WebdriverIO measures it. */
  durationMs?: number;
  startedAt?: Date;
}

interface ErrorLike {
  message?: string;
  stack?: string;
}

/** Pulls the reportable text off an error, tolerating a bare string. */
export function describeError(err: ErrorLike | string | undefined): { message?: string; trace?: string } {
  if (!err) {
    return {};
  }
  // Trimmed: Jasmine's messages end in a run of spaces and a newline, which is
  // noise in every view that shows the message on one line.
  const message = (typeof err === 'string' ? err : err.message)?.trim();
  if (typeof err === 'string') {
    return message ? { message: truncateRunes(message, MAX_ATTEMPT_MESSAGE_RUNES) } : {};
  }
  return {
    ...(message ? { message: truncateRunes(message, MAX_ATTEMPT_MESSAGE_RUNES) } : {}),
    ...(err.stack ? { trace: truncateRunes(err.stack, MAX_ATTEMPT_TRACE_RUNES) } : {}),
  };
}

/**
 * Builds the wire `attempts[]` from every execution of one test, in order, the
 * last being the terminal one. Undefined below two attempts: the server persists
 * nothing for a lone attempt, so sending one is bytes for a discarded row.
 */
export function buildAttempts(recorded: readonly RecordedAttempt[]): Attempt[] | undefined {
  if (recorded.length < 2) {
    return undefined;
  }
  const out: Attempt[] = recorded.map((r, i) => ({
    attempt: i + 1,
    status: r.status,
    ...(typeof r.durationMs === 'number' && r.durationMs > 0 ? { duration: msToNs(r.durationMs) } : {}),
    ...(r.startedAt && !Number.isNaN(r.startedAt.getTime()) ? { startedAt: r.startedAt.toISOString() } : {}),
    ...(r.message ? { message: r.message } : {}),
    ...(r.trace ? { trace: r.trace } : {}),
  }));
  return clampAttempts(out);
}

/**
 * Bounds the list to what one case run persists, keeping the FINAL attempt.
 * A plain `slice(0, MAX)` would discard the attempt that carries the outcome.
 */
export function clampAttempts(attempts: Attempt[]): Attempt[] {
  if (attempts.length <= MAX_ATTEMPTS_PER_CASE) {
    return attempts;
  }
  return [...attempts.slice(0, MAX_ATTEMPTS_PER_CASE - 1), attempts[attempts.length - 1]!];
}
