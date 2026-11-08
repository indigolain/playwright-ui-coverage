import { describe, expect, it } from 'vitest';
import { isPassingResult, selectAttempts, type AttemptEntry } from '../src/attempts';

const data = { interactions: [], snapshots: [] };
const attempt = (testId: string, retry: number, passed: boolean): AttemptEntry => ({
  testId,
  retry,
  passed,
  title: `${testId} #${retry}`,
  data,
});
const uses = (entries: AttemptEntry[], countFailedTests = false) =>
  selectAttempts(entries, { countFailedTests }).map((e) => [e.title, e.interactions]);

describe('isPassingResult', () => {
  it('passes when the status is the expected one', () => {
    expect(isPassingResult({ expectedStatus: 'passed' }, { status: 'passed' })).toBe(true);
    expect(isPassingResult({ expectedStatus: 'passed' }, { status: 'failed' })).toBe(false);
    expect(isPassingResult({ expectedStatus: 'passed' }, { status: 'timedOut' })).toBe(false);
    expect(isPassingResult({ expectedStatus: 'passed' }, { status: 'interrupted' })).toBe(false);
  });

  it('treats an expected failure (test.fail()) as passing', () => {
    expect(isPassingResult({ expectedStatus: 'failed' }, { status: 'failed' })).toBe(true);
    expect(isPassingResult({ expectedStatus: 'failed' }, { status: 'passed' })).toBe(false);
  });

  it('never passes a skipped attempt', () => {
    expect(isPassingResult({ expectedStatus: 'skipped' }, { status: 'skipped' })).toBe(false);
  });
});

describe('selectAttempts', () => {
  it('counts a passing test', () => {
    expect(uses([attempt('a', 0, true)])).toEqual([['a #0', 'tested']]);
  });

  it('counts only the passing retry of a flaky test', () => {
    expect(uses([attempt('a', 0, false), attempt('a', 1, true)])).toEqual([
      ['a #0', 'ignore'],
      ['a #1', 'tested'],
    ]);
  });

  it('counts only the last passing attempt when several passed', () => {
    expect(uses([attempt('a', 1, true), attempt('a', 0, true), attempt('a', 2, false)])).toEqual([
      ['a #1', 'tested'],
      ['a #0', 'ignore'],
      ['a #2', 'ignore'],
    ]);
  });

  it('keeps interactions of tests that never passed as failing', () => {
    expect(uses([attempt('a', 0, false), attempt('a', 1, false), attempt('b', 0, true)])).toEqual([
      ['a #0', 'failing'],
      ['a #1', 'failing'],
      ['b #0', 'tested'],
    ]);
  });

  it('counts every attempt with countFailedTests', () => {
    expect(uses([attempt('a', 0, false), attempt('a', 1, true)], true)).toEqual([
      ['a #0', 'tested'],
      ['a #1', 'tested'],
    ]);
  });

  it('passes testId and data through', () => {
    const [entry] = selectAttempts([attempt('a', 0, true)], { countFailedTests: false });
    expect(entry).toMatchObject({ testId: 'a', data });
  });
});
