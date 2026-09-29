import type { CasePriority, LinkType } from '../shared/types.js';

/**
 * The messages a `qualflare.*()` call records against the running test (see
 * `qualflare-api.ts` and `store.ts`).
 *
 * `step_start`/`step_stop` are deliberately a flat PAIR rather than a nested
 * structure: the arrival order of the pairs reconstructs nesting exactly, and
 * `case-builder.ts` recovers `parentIndex` by walking the stream with a stack.
 * The same shape is used across the reporter family.
 */
export type RuntimeMessage =
  | { type: 'label'; name: string; value: string }
  | { type: 'link'; url: string; linkType?: LinkType; name?: string }
  | { type: 'tag'; tags: string[] }
  | { type: 'description'; text: string }
  | { type: 'priority'; value: CasePriority }
  | { type: 'parameter'; name: string; value?: string; masked?: boolean }
  | { type: 'attachment'; name: string; contentBase64: string; mimeType?: string }
  | { type: 'attachment_from_file'; name: string; path: string; mimeType?: string }
  | { type: 'step_start'; name: string; timestamp: number }
  | { type: 'step_stop'; status: 'passed' | 'failed'; error?: string; timestamp: number };
