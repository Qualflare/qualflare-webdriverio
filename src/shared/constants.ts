/**
 * Shared constants used across the reporter and the author-facing runtime
 * API.
 */

/** Server-side caps this client should respect defensively (see
 * `api-service/internal/core/domain/launch/launch.go`). */
export const MAX_SUITES_PER_LAUNCH = 2000;
export const MAX_CASES_PER_SUITE = 5000;
export const MAX_STEPS_PER_CASE = 1000;
export const MAX_PARAMETERS_PER_STEP = 50;
export const MAX_ATTACHMENTS_PER_CASE = 50;
export const MAX_LABELS_PER_CASE = 100;
export const MAX_LINKS_PER_CASE = 20;
export const MAX_TAGS_PER_CASE = 64;
export const MAX_TAG_LENGTH = 255;

/** Client-side SOFT cap on steps recorded per test attempt — well under
 * the server's 1000-per-case hard cap (`MAX_STEPS_PER_CASE`). Once hit,
 * further steps within that attempt are dropped (with a one-time warning),
 * not queued and truncated later. */
export const MAX_STEPS_PER_TEST_ATTEMPT = 300;

/**
 * Server-side bounds on `Case.attempts`, mirrored client-side so the bytes are
 * never sent rather than truncated on arrival. Values match the sibling
 * reporters and `case_run_attempts`.
 */
export const MAX_ATTEMPTS_PER_CASE = 50;
export const MAX_ATTEMPT_MESSAGE_RUNES = 8192;
export const MAX_ATTEMPT_TRACE_RUNES = 32768;

/** Bounds on the per-attempt text fields. WebdriverIO exposes no captured
 * stdout/stderr to a reporter, so the OUTPUT caps are unused today; they mirror
 * the server's own limits so a future use starts from the right number. */
export const MAX_ATTEMPT_SNIPPET_RUNES = 4096;
export const MAX_ATTEMPT_OUTPUT_RUNES = 16384;
export const MAX_ATTEMPT_OUTPUT_LINES = 200;
