/**
 * A minimal logger that genuinely writes to stderr.
 *
 * It bypasses `console` because WebdriverIO's own reporters (spec, dot) own the
 * terminal's stdout, and a diagnostic line interleaved there is unreadable. A
 * worker's stderr is still forwarded to the launcher's terminal, prefixed with
 * the worker's cid, which is exactly where a reporter warning should appear.
 */

const PREFIX = '[qualflare-webdriverio]';

function write(stream: NodeJS.WriteStream, args: unknown[]): void {
  try {
    const text = args
      .map((a) => (typeof a === 'string' ? a : String(a instanceof Error ? a.message : a)))
      .join(' ');
    stream.write(`${PREFIX} ${text}\n`);
  } catch {
    // A logger must never be the reason a run fails.
  }
}

export const logger = {
  debug(...args: unknown[]): void {
    write(process.stderr, args);
  },
  info(...args: unknown[]): void {
    write(process.stderr, args);
  },
  warn(...args: unknown[]): void {
    write(process.stderr, args);
  },
  error(...args: unknown[]): void {
    write(process.stderr, args);
  },
};
