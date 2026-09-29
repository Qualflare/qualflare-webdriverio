import type { ResolvedReporterConfig } from '../config/resolve-config.js';
import {
  MAX_ATTACHMENTS_PER_CASE,
  MAX_LABELS_PER_CASE,
  MAX_LINKS_PER_CASE,
  MAX_PARAMETERS_PER_STEP,
  MAX_STEPS_PER_TEST_ATTEMPT,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_CASE,
} from '../shared/constants.js';
import { logger } from '../shared/logger.js';
import { propertyValue } from '../shared/parameters.js';
import type {
  Attachment,
  Case,
  CaseStatus,
  Label,
  Link,
  Parameter,
  Step,
} from '../shared/types.js';
import type { RuntimeMessage } from '../runtime/message-types.js';
import { msToNs } from '../shared/duration.js';
import { AttachmentBudget, inlineFromBuffer, inlineFromFile } from './attachment-reader.js';
import { copyImageAttachment, isOffloadableImage, writeImageAttachment } from './image-writer.js';
import { buildAttempts, type RecordedAttempt } from './attempts.js';

/**
 * Maps WebdriverIO's test state onto the wire contract's vocabulary.
 *
 * `qualflare-cli` accepts exactly 7 values and turns anything it does not
 * recognize into `error` -- NOT into a pass -- so each is mapped explicitly.
 * WebdriverIO calls a skipped test `skipped` or `pending` depending on how it was
 * skipped; both are `skipped` here. A timeout is a failure whose message says so.
 */
export function mapStatus(state: string | undefined): CaseStatus {
  switch (state) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'skipped':
    case 'pending':
      return 'skipped';
    default:
      // No terminal state: the worker ended while the test was still running.
      // `error` says "did not run to a verdict"; `failed` would blame the test.
      return 'error';
  }
}

interface ReplayedMetadata {
  labels: Label[];
  links: Link[];
  tags: string[];
  description?: string;
  priority?: Case['priority'];
  caseParameters: Parameter[];
  attachments: Attachment[];
  steps: Step[];
}

/**
 * Replays the messages a test emitted into structured metadata.
 *
 * The channel is append-only and flat, so `step_start`/`step_stop` arrive as a
 * pair stream. Walking it with a stack recovers nesting exactly: the index of
 * the enclosing step becomes `parentIndex`, and parameters declared inside a
 * step attach to that step rather than to the case.
 */
export function replayMetadata(
  messages: readonly RuntimeMessage[],
  config: ResolvedReporterConfig,
  budget: AttachmentBudget,
): ReplayedMetadata {
  const meta: ReplayedMetadata = {
    labels: [],
    links: [],
    tags: [],
    caseParameters: [],
    attachments: [],
    steps: [],
  };
  const openSteps: number[] = [];
  // step_start timestamps, parallel to openSteps, so step_stop can compute a
  // real duration rather than reporting every step as instantaneous.
  const openStartedAt: number[] = [];
  let warnedStepCap = false;

  for (const message of messages) {
    switch (message.type) {
      case 'label':
        meta.labels.push({ name: message.name, value: message.value });
        break;
      case 'link':
        meta.links.push({
          url: message.url,
          // `type` is required on the wire and validated server-side against
          // issue/tms/custom. 'custom' is the neutral default when the author
          // did not say.
          type: message.linkType ?? 'custom',
          ...(message.name ? { name: message.name } : {}),
        });
        break;
      case 'tag':
        meta.tags.push(...message.tags);
        break;
      case 'description':
        meta.description = message.text;
        break;
      case 'priority':
        meta.priority = message.value;
        break;
      case 'parameter': {
        const param: Parameter = {
          name: message.name,
          ...(message.value !== undefined ? { value: message.value } : {}),
          ...(message.masked ? { masked: true } : {}),
        };
        const openStep = openSteps[openSteps.length - 1];
        if (openStep === undefined) {
          meta.caseParameters.push(param);
        } else {
          const step = meta.steps[openStep];
          // Capped, and pushed rather than re-spread: the previous form
          // allocated a fresh array per parameter, which is O(n^2) on a step
          // that records many.
          if (step) {
            if (!step.parameters) {
              step.parameters = [];
            }
            if (step.parameters.length < MAX_PARAMETERS_PER_STEP) {
              step.parameters.push(param);
            }
          }
        }
        break;
      }
      case 'attachment': {
        const bytes = Buffer.from(message.contentBase64, 'base64');
        const attachment = imageFromBuffer(message.name, bytes, message.mimeType, config);
        if (attachment) {
          meta.attachments.push(attachment);
          break;
        }
        const inlined = inlineFromBuffer(message.name, bytes, message.mimeType, config, budget);
        if (inlined) {
          meta.attachments.push(inlined);
        }
        break;
      }
      case 'attachment_from_file': {
        const attachment = imageFromFile(message.name, message.path, config);
        if (attachment) {
          meta.attachments.push(attachment);
          break;
        }
        const fromFile = inlineFromFile(message.name, message.path, message.mimeType, config, budget);
        if (fromFile) {
          meta.attachments.push(fromFile);
        }
        break;
      }
      case 'step_start': {
        if (meta.steps.length >= MAX_STEPS_PER_TEST_ATTEMPT) {
          if (!warnedStepCap) {
            warnedStepCap = true;
            logger.warn(
              `a test recorded more than ${MAX_STEPS_PER_TEST_ATTEMPT} steps; the rest were dropped.`,
            );
          }
          break;
        }
        const parentIndex = openSteps[openSteps.length - 1];
        const step: Step = {
          name: message.name,
          status: 'passed',
          duration: 0,
          ...(parentIndex !== undefined ? { parentIndex } : {}),
        };
        openSteps.push(meta.steps.length);
        openStartedAt.push(message.timestamp);
        meta.steps.push(step);
        break;
      }
      case 'step_stop': {
        const index = openSteps.pop();
        const startedAt = openStartedAt.pop();
        if (index === undefined) {
          break;
        }
        const step = meta.steps[index];
        if (step) {
          step.status = message.status;
          if (startedAt !== undefined) {
            step.duration = msToNs(Math.max(0, message.timestamp - startedAt));
          }
          if (message.error) {
            step.error = message.error;
          }
        }
        break;
      }
    }
  }
  return meta;
}

/** Routes an on-disk image onto `localImagePath`, or undefined so the caller
 * falls through to inlining. Undefined is the ordinary outcome for a log or a
 * JSON blob, and also for an image the writer could not place — so a bad
 * outputDir costs the offload rather than the user's attachment. */
function imageFromFile(
  name: string,
  filePath: string,
  config: ResolvedReporterConfig,
): Attachment | undefined {
  const copied = copyImageAttachment(filePath, config.outputDir, config.maxAttachmentBytes);
  if (!copied) {
    return undefined;
  }
  return {
    name,
    mimeType: copied.mimeType,
    localImagePath: copied.localImagePath,
    fileSize: copied.fileSize,
  };
}

/** The in-memory counterpart — the shape `qualflare.attachment()` produces. */
function imageFromBuffer(
  name: string,
  bytes: Buffer,
  mimeType: string | undefined,
  config: ResolvedReporterConfig,
): Attachment | undefined {
  if (!isOffloadableImage(mimeType)) {
    return undefined;
  }
  const written = writeImageAttachment(bytes, mimeType, config.outputDir, config.maxAttachmentBytes);
  if (!written) {
    return undefined;
  }
  return {
    name,
    mimeType: written.mimeType,
    localImagePath: written.localImagePath,
    fileSize: written.fileSize,
  };
}

function capTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.slice(0, MAX_TAG_LENGTH);
    if (trimmed === '' || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= MAX_TAGS_PER_CASE) {
      break;
    }
  }
  return out;
}

/** One test, all of its attempts finished, ready to become a wire Case. */
export interface FinishedTest {
  /** `${file}#${name}@${capabilityKey}` -- see the reporter for why each part. */
  id: string;
  name: string;
  /** Relative to the WebdriverIO project root, POSIX separators. */
  file: string;
  /** Every execution in order; the last is the terminal one. */
  attempts: readonly RecordedAttempt[];
  /** What the FINAL attempt recorded through `qualflare.*()`. Metadata from a
   * superseded attempt is discarded, as across the reporter family. */
  messages: readonly RuntimeMessage[];
  /** Screenshots WebdriverIO took during ANY attempt, already on disk. Kept
   * across attempts on purpose: a flaky test's failure screenshot is the most
   * useful thing it leaves behind. */
  screenshots: readonly Attachment[];
  /** Capability values of the session, recorded on the case. */
  capabilityProperties: Readonly<Record<string, string>>;
}

export function buildCase(
  test: FinishedTest,
  config: ResolvedReporterConfig,
  budget: AttachmentBudget,
): Case {
  const final = test.attempts[test.attempts.length - 1];
  const status = final?.status ?? 'error';
  const meta = replayMetadata(test.messages, config, budget);

  // Capabilities first, then the file, then the author's own parameters, so an
  // explicit qualflare.parameter() is never overwritten by a derived value.
  const properties: Record<string, string> = { ...test.capabilityProperties, file: test.file };
  for (const param of meta.caseParameters) {
    properties[param.name] = propertyValue(param.value, param.masked);
  }

  const attempts = buildAttempts(test.attempts);
  // `retryCount` counts RETRIES, not executions. Flaky only when the final
  // status is a pass: "failed after retries" is failed, not flaky.
  const retryCount = attempts ? attempts.length - 1 : 0;
  const attachments = [...test.screenshots, ...meta.attachments];

  const built: Case = {
    id: test.id,
    name: test.name,
    status,
    duration: msToNs(typeof final?.durationMs === 'number' ? final.durationMs : 0),
    properties,
    ...(status === 'failed' && final?.message ? { error: final.message } : {}),
    ...(status === 'failed' && final?.trace ? { trace: final.trace } : {}),
    ...(meta.labels.length > 0 ? { labels: meta.labels.slice(0, MAX_LABELS_PER_CASE) } : {}),
    ...(meta.links.length > 0 ? { links: meta.links.slice(0, MAX_LINKS_PER_CASE) } : {}),
    ...(meta.tags.length > 0 ? { tags: capTags(meta.tags) } : {}),
    ...(meta.description ? { description: meta.description } : {}),
    ...(meta.priority ? { priority: meta.priority } : {}),
    ...(meta.steps.length > 0 ? { steps: meta.steps.slice(0, MAX_STEPS_PER_TEST_ATTEMPT) } : {}),
    ...(attachments.length > 0 ? { attachments: attachments.slice(0, MAX_ATTACHMENTS_PER_CASE) } : {}),
    ...(attempts ? { attempts, retryCount, isFlaky: status === 'passed' } : {}),
  };

  if (config.shardIndex !== undefined) {
    built.shardIndex = config.shardIndex;
  }
  return built;
}
