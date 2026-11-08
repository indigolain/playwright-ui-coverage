import { describe, expect, it } from 'vitest';
import type { CoverageSummary, RouteCoverage } from '../src/aggregate';
import { evaluateThresholds, formatThresholdResults } from '../src/thresholds';

const route = (name: string, percent: number) => ({ route: name, percent }) as RouteCoverage;
const summary = (percent: number, routes: [string, number][]) =>
  ({ percent, routes: routes.map(([r, p]) => route(r, p)) }) as CoverageSummary;

const s = summary(50, [
  ['/', 80],
  ['/users', 40],
  ['/users/:id', 20],
  ['/users/:id/edit', 10],
  ['/settings', 60],
]);

const byTarget = (results: ReturnType<typeof evaluateThresholds>) =>
  Object.fromEntries(results.map((r) => [r.target, r]));

describe('evaluateThresholds', () => {
  it('returns nothing without an option', () => {
    expect(evaluateThresholds(s, undefined)).toEqual([]);
  });

  it('treats a number as the overall threshold', () => {
    expect(evaluateThresholds(s, 50)).toEqual([
      { target: 'overall', required: 50, actual: 50, passed: true, status: 'passed' },
    ]);
    expect(evaluateThresholds(s, 50.1)[0]).toMatchObject({ passed: false, status: 'failed' });
  });

  it('checks exact views and reports missing ones without failing', () => {
    const r = byTarget(evaluateThresholds(s, { views: { '/users': 50, '/settings': 60, '/nope': 10 } }));
    expect(r['/users']).toMatchObject({ actual: 40, passed: false, status: 'failed' });
    expect(r['/settings']).toMatchObject({ actual: 60, passed: true, status: 'passed' });
    expect(r['/nope']).toMatchObject({ actual: null, passed: true, status: 'missing' });
  });

  it('matches * within one segment and ** across segments', () => {
    const one = byTarget(evaluateThresholds(s, { views: { '/users/*': 15 } }));
    expect(Object.keys(one)).toEqual(['/users/:id']);
    expect(one['/users/:id']).toMatchObject({ pattern: '/users/*', required: 15, passed: true });

    const deep = byTarget(evaluateThresholds(s, { views: { '/users/**': 15 } }));
    expect(Object.keys(deep).sort()).toEqual(['/users/:id', '/users/:id/edit']);
    expect(deep['/users/:id/edit']).toMatchObject({ passed: false, status: 'failed' });
  });

  it('lets an exact key win over a pattern', () => {
    const r = evaluateThresholds(s, { views: { '/users/*': 90, '/users/:id': 5 } });
    expect(r).toEqual([{ target: '/users/:id', required: 5, actual: 20, passed: true, status: 'passed' }]);
  });

  it('prefers the most specific pattern, then fewer **, then declaration order', () => {
    const specific = byTarget(evaluateThresholds(s, { views: { '/**': 1, '/users/**': 2 } }));
    expect(specific['/users/:id'].pattern).toBe('/users/**');
    expect(specific['/settings'].pattern).toBe('/**');

    const fewerDeep = byTarget(evaluateThresholds(s, { views: { '/users/**': 1, '/users/*': 2 } }));
    expect(fewerDeep['/users/:id'].pattern).toBe('/users/*');

    const first = byTarget(evaluateThresholds(s, { views: { '/u*/:id': 1, '/*s/:id': 2 } }));
    expect(first['/users/:id'].pattern).toBe('/u*/:id');
    const swapped = byTarget(evaluateThresholds(s, { views: { '/*s/:id': 2, '/u*/:id': 1 } }));
    expect(swapped['/users/:id'].pattern).toBe('/*s/:id');
  });

  it('reports patterns that match no view as missing', () => {
    expect(evaluateThresholds(s, { views: { '/admin/**': 10 } })).toEqual([
      { target: '/admin/**', pattern: '/admin/**', required: 10, actual: null, passed: true, status: 'missing' },
    ]);
  });

  it('escapes regex characters in keys', () => {
    const r = evaluateThresholds(summary(0, [['/a.b', 0], ['/axb', 0]]), { views: { '/a.b*': 1 } });
    expect(r.map((x) => x.target)).toEqual(['/a.b']);
  });
});

describe('formatThresholdResults', () => {
  it('warns about missing views with a "did you mean" hint and lists failures', () => {
    const results = evaluateThresholds(s, { overall: 60, views: { '/setings': 10, '/users': 50 } });
    const { warnings, errors } = formatThresholdResults(results, s.routes.map((r) => r.route));
    expect(warnings).toEqual([
      'UI coverage threshold: view "/setings" was not found in this run (did you mean "/settings"?); skipped.',
    ]);
    expect(errors[0]).toBe('UI coverage below threshold (2):');
    expect(errors.slice(1).map((l) => l.trim().split(/\s+/)[0])).toEqual(['overall', '/users']);
  });

  it('is empty when everything passed', () => {
    expect(formatThresholdResults(evaluateThresholds(s, 10), [])).toEqual({ warnings: [], errors: [] });
  });
});
