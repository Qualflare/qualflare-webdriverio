import { buildParameter } from '../shared/parameters.js';
import { logger } from '../shared/logger.js';
import type { CasePriority, LinkType } from '../shared/types.js';
import { emit } from './store.js';

/**
 * The author-facing metadata API.
 *
 * Every call is fire-and-forget and fail-open: a metadata problem must never
 * fail somebody's test run, so nothing here throws and nothing returns a
 * promise that could reject unhandled.
 */
export const qualflare = {
  /** Allure-style name/value metadata (epic, feature, story, owner, ...). */
  label(name: string, value: string): void {
    emit({ type: 'label', name, value });
  },

  /** An external link. `type` is one of issue/tms/custom; unknown values are
   * rejected server-side rather than rewritten, so it is passed through. */
  link(url: string, opts?: { type?: LinkType; name?: string }): void {
    emit({
      type: 'link',
      url,
      ...(opts?.type ? { linkType: opts.type } : {}),
      ...(opts?.name ? { name: opts.name } : {}),
    });
  },

  tag(...tags: string[]): void {
    if (tags.length > 0) {
      emit({ type: 'tag', tags });
    }
  },

  description(text: string): void {
    emit({ type: 'description', text });
  },

  priority(value: CasePriority): void {
    emit({ type: 'priority', value });
  },

  /**
   * A case- or step-level parameter.
   *
   * Masking happens here, at the call, so a masked value is never held
   * anywhere: `buildParameter` drops it entirely, and it never reaches the
   * report or the server.
   */
  parameter(name: string, value?: string, opts?: { masked?: boolean }): void {
    const param = buildParameter(name, value, opts?.masked);
    emit({
      type: 'parameter',
      name: param.name,
      ...(param.value !== undefined ? { value: param.value } : {}),
      ...(param.masked ? { masked: true } : {}),
    });
  },

  /** Attaches in-memory content. Images are written into the results
   * directory when the report is built; anything else is inlined. */
  attachment(name: string, content: string, opts?: { encoding?: 'utf8' | 'base64'; mimeType?: string }): void {
    const contentBase64 =
      opts?.encoding === 'base64' ? content : Buffer.from(content, 'utf8').toString('base64');
    emit({
      type: 'attachment',
      name,
      contentBase64,
      ...(opts?.mimeType ? { mimeType: opts.mimeType } : {}),
    });
  },

  /** Attaches a file by path. Only the path travels; the reporter reads it. */
  attachmentFromFile(name: string, path: string, opts?: { mimeType?: string }): void {
    emit({
      type: 'attachment_from_file',
      name,
      path,
      ...(opts?.mimeType ? { mimeType: opts.mimeType } : {}),
    });
  },

  /**
   * Records a named step around `fn`, returning whatever `fn` returns.
   *
   * The user's error is always rethrown untouched — the step is recorded as
   * failed on the way past. Only the bookkeeping is wrapped, never `fn` itself,
   * so this can never swallow or alter a test's own failure.
   */
  async step<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
      emit({ type: 'step_start', name, timestamp: startedAt });
    } catch {
      // Bookkeeping only; never let it touch the body below.
    }

    try {
      const result = await fn();
      closeStep('passed');
      return result;
    } catch (err) {
      closeStep('failed', err instanceof Error ? err.message : String(err));
      throw err;
    }
  },
};

function closeStep(status: 'passed' | 'failed', error?: string): void {
  try {
    emit({ type: 'step_stop', status, ...(error ? { error } : {}), timestamp: Date.now() });
  } catch {
    logger.warn('could not record the end of a qualflare.step()');
  }
}
