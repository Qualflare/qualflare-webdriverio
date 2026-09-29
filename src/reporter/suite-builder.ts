import * as path from 'node:path';

import { MAX_CASES_PER_SUITE, MAX_SUITES_PER_LAUNCH } from '../shared/constants.js';
import { logger } from '../shared/logger.js';
import type { Case, FrameworkCategory, Suite } from '../shared/types.js';

/**
 * Makes a test-module path stable and portable: relative to the
 * project root, with POSIX separators regardless of the OS that produced it.
 *
 * Without this, the same suite reported from a Windows runner and a Linux
 * runner would be two different suites server-side, and an absolute path
 * would leak a CI agent's directory layout into the report.
 */
export function relativizeFile(file: string, rootDir: string): string {
  const relative = path.isAbsolute(file) ? path.relative(rootDir, file) : file;
  return relative.split(path.sep).join('/');
}

/** One case plus the spec file it came from. */
export interface CaseWithFile {
  file: string;
  testCase: Case;
}

/**
 * Groups finished cases into one Suite per spec file, once, at the end of the
 * worker. `category` is the framework label, which the server validates against
 * its test_type enum.
 */
export function groupIntoSuites(cases: readonly CaseWithFile[], category: FrameworkCategory): Suite[] {
  const byFile = new Map<string, CaseWithFile[]>();
  for (const entry of cases) {
    const existing = byFile.get(entry.file);
    if (existing) {
      existing.push(entry);
    } else {
      byFile.set(entry.file, [entry]);
    }
  }

  const suites: Suite[] = [];
  for (const [file, entries] of byFile) {
    let kept = entries;
    if (kept.length > MAX_CASES_PER_SUITE) {
      logger.warn(
        `suite "${file}" produced ${kept.length} cases, over the server's limit of ${MAX_CASES_PER_SUITE}; the rest were dropped.`,
      );
      kept = kept.slice(0, MAX_CASES_PER_SUITE);
    }

    suites.push({
      name: file,
      category,
      duration: kept.reduce((sum, e) => sum + e.testCase.duration, 0),
      cases: kept.map((e) => e.testCase),
    });
  }

  if (suites.length > MAX_SUITES_PER_LAUNCH) {
    logger.warn(
      `this run produced ${suites.length} suites, over the server's limit of ${MAX_SUITES_PER_LAUNCH}; the rest were dropped.`,
    );
    return suites.slice(0, MAX_SUITES_PER_LAUNCH);
  }
  return suites;
}
