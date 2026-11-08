import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoverageSummary } from '../src/aggregate';
import type { AttemptEntry } from '../src/attempts';
import { indexTests, interactionTotal, mostRepeated, resolveHtmlReport } from '../src/insights';

const data = { interactions: [], snapshots: [] };
const attempt = (o: Partial<AttemptEntry>): AttemptEntry => ({ testId: 't', retry: 0, passed: true, title: 'T', data, ...o });

describe('indexTests', () => {
  it('links to the last passing attempt, else the last attempt', () => {
    const tests = indexTests([
      attempt({ testId: 'flaky', title: 'flaky', retry: 0, passed: false }),
      attempt({ testId: 'flaky', title: 'flaky', retry: 1, passed: true, trace: 'abc.zip' }),
      attempt({ testId: 'flaky', title: 'flaky', retry: 2, passed: false }),
      attempt({ testId: 'broken', title: 'broken', retry: 0, passed: false }),
      attempt({ testId: 'broken', title: 'broken', retry: 1, passed: false }),
    ]);
    expect(tests).toEqual([
      { id: 'broken', title: 'broken', run: 1, passed: false },
      { id: 'flaky', title: 'flaky', run: 1, passed: true, trace: 'abc.zip' },
    ]);
  });

  it('sorts by title, then project, then id', () => {
    const tests = indexTests([
      attempt({ testId: '3', title: 'b' }),
      attempt({ testId: '2', title: 'a', project: 'webkit' }),
      attempt({ testId: '1', title: 'a', project: 'chromium' }),
    ]);
    expect(tests.map((t) => t.id)).toEqual(['1', '2', '3']);
    expect(tests[0].project).toBe('chromium');
  });
});

describe('mostRepeated', () => {
  const el = (key: string, testedBy: string[], counts: Record<string, number> = {}) => ({
    key,
    label: key,
    testedBy,
    interactionCounts: counts,
  });
  const summary = {
    routes: [
      { route: '/login', elements: [el('#user', ['a', 'b', 'c'], { input: 6 }), el('#pass', ['a', 'b', 'c'], { input: 3 })] },
      { route: '/home', elements: [el('#once', ['a']), el('#twice', ['a', 'b'], { click: 2 })] },
    ],
  } as unknown as CoverageSummary;

  it('lists elements used by 2+ tests, most first, with their share of all tests', () => {
    expect(mostRepeated(summary)).toEqual([
      { route: '/login', key: '#user', label: '#user', tests: 3, interactions: 6, share: 100 },
      { route: '/login', key: '#pass', label: '#pass', tests: 3, interactions: 3, share: 100 },
      { route: '/home', key: '#twice', label: '#twice', tests: 2, interactions: 2, share: 66.7 },
    ]);
  });

  it('respects the limit', () => {
    expect(mostRepeated(summary, 1)).toHaveLength(1);
  });

  it('interactionTotal sums all types', () => {
    expect(interactionTotal({ click: 2, input: 3 })).toBe(5);
    expect(interactionTotal(undefined)).toBe(0);
  });
});

describe('resolveHtmlReport', () => {
  const root = path.resolve(__dirname, '..'); // has a package.json
  const out = path.join(root, 'ui-coverage-report');
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  for (const k of ['PLAYWRIGHT_HTML_OUTPUT_DIR', 'PLAYWRIGHT_HTML_REPORT', 'PLAYWRIGHT_HTML_ATTACHMENTS_BASE_URL']) delete process.env[k];

  it('is off without an html reporter or with override false', () => {
    expect(resolveHtmlReport([['list']], root, out)).toBeUndefined();
    expect(resolveHtmlReport([['html']], root, out, false)).toBeUndefined();
  });

  it('defaults to playwright-report next to package.json', () => {
    expect(resolveHtmlReport([['list'], ['html', { open: 'never' }]], path.join(root, 'demo'), out)).toEqual({
      path: '../playwright-report',
      attachmentsBaseURL: 'data/',
    });
  });

  it('uses outputFolder and attachmentsBaseURL from the reporter options', () => {
    expect(resolveHtmlReport([['html', { outputFolder: 'reports/html', attachmentsBaseURL: 'https://cdn/x/' }]], root, out)).toEqual({
      path: '../reports/html',
      attachmentsBaseURL: 'https://cdn/x/',
    });
  });

  it('lets the environment and the override win', () => {
    process.env.PLAYWRIGHT_HTML_OUTPUT_DIR = path.join(root, 'env-report');
    process.env.PLAYWRIGHT_HTML_ATTACHMENTS_BASE_URL = 'att/';
    expect(resolveHtmlReport([['html', { outputFolder: 'x' }]], root, out)).toEqual({ path: '../env-report', attachmentsBaseURL: 'att/' });
    expect(resolveHtmlReport([], root, out, 'custom')?.path).toBe('../custom');
  });
});
