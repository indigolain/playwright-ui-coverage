import type { TestCase, TestResult } from '@playwright/test/reporter';
import type { InteractionUse, TestEntry } from './aggregate';
import type { TestCoverageData } from './types';

/** One `ui-coverage` attachment, tagged with the attempt it came from. */
export interface AttemptEntry {
  /** `TestCase.id`: the same across retries of one test. */
  testId: string;
  /** `TestResult.retry`: 0 for the first attempt. */
  retry: number;
  /** Whether this attempt had the expected outcome (see `isPassingResult`). */
  passed: boolean;
  title: string;
  data: TestCoverageData;
}

/**
 * An attempt "passed" when its status is the one the test expects
 * (`passed` normally, `failed` for `test.fail()`). Skipped, timed-out and
 * interrupted attempts never pass.
 */
export function isPassingResult(test: Pick<TestCase, 'expectedStatus'>, result: Pick<TestResult, 'status'>): boolean {
  return result.status !== 'skipped' && result.status === test.expectedStatus;
}

/**
 * Decides which attempts' interactions count. Inventories (element totals)
 * from every attempt always count.
 *
 * - `countFailedTests: true`: interactions from every attempt count.
 * - Otherwise, per test:
 *   - if any attempt passed, only the last passing attempt's interactions count
 *     (for a flaky test, the retry that passed); other attempts add inventories only;
 *   - if no attempt passed, interactions are kept as "failing" so the report can
 *     show elements touched only by failing tests, but they don't count as tested.
 */
export function selectAttempts(entries: AttemptEntry[], opts: { countFailedTests: boolean }): TestEntry[] {
  const lastPassing = new Map<string, number>();
  for (const e of entries) {
    if (e.passed) lastPassing.set(e.testId, Math.max(lastPassing.get(e.testId) ?? -1, e.retry));
  }
  return entries.map(({ title, data, testId, retry }) => {
    let interactions: InteractionUse = 'tested';
    if (!opts.countFailedTests) {
      const pass = lastPassing.get(testId);
      if (pass === undefined) interactions = 'failing';
      else if (retry !== pass) interactions = 'ignore';
    }
    return { title, data, interactions };
  });
}
