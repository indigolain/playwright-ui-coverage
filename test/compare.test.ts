import { describe, expect, it } from 'vitest';
import { compareReports } from '../src/compare';
import { comparisonMarkdown, MARKDOWN_MARKER, mdCode, mdText, reportMarkdown } from '../src/markdown';
import { makeReport } from './report-fixture';

const base = makeReport(
  {
    '/settings': { save: true, theme: false, bio: false },
    '/users': { add: true, search: true },
    '/user/:id': { edit: false, back: true, del: false },
    '/old': { x: false },
  },
  [{ scope: 'view', view: '/settings', required: 30, actual: 33.3, status: 'passed' }],
);
const head = makeReport(
  {
    '/settings': { save: false, theme: true, notify: false },
    '/users': { add: true, search: true },
    '/users/:id': { edit: false, back: true, del: false },
    '/checkout': { pay: false, cancel: false },
  },
  [{ scope: 'view', view: '/settings', required: 30, actual: 33.3, status: 'passed' }],
);
head.thresholds = [{ scope: 'overall', required: 50, actual: 40, status: 'failed' }];

describe('compareReports', () => {
  const c = compareReports(base, head);

  it('computes the overall delta', () => {
    expect(c.base).toMatchObject({ coverage: 44.4, testedUnits: 4, totalUnits: 9, viewCount: 4 });
    expect(c.head).toMatchObject({ coverage: 40, testedUnits: 4, totalUnits: 10, viewCount: 4 });
    expect(c.delta).toBe(-4.4);
  });

  it('lists new gaps with a reason, and resolved gaps', () => {
    expect(c.newGaps.map((u) => [u.view, u.key, u.reason])).toEqual([
      ['/checkout', 'cancel', 'new-view'],
      ['/checkout', 'pay', 'new-view'],
      ['/settings', 'notify', 'new'],
      ['/settings', 'save', 'regressed'],
    ]);
    expect(c.resolved.map((u) => [u.view, u.key, u.reason])).toEqual([['/settings', 'theme', 'tested']]);
  });

  it('classifies views, matching renames by their keys', () => {
    expect(c.views.map((v) => [v.name, v.status, v.from])).toEqual([
      ['/checkout', 'added', undefined],
      ['/old', 'removed', undefined],
      ['/settings', 'changed', undefined],
      ['/users', 'unchanged', undefined],
      ['/users/:id', 'renamed', '/user/:id'],
    ]);
    expect(c.addedViews).toEqual(['/checkout']);
    expect(c.removedViews).toEqual(['/old']);
    expect(c.renamedViews).toEqual([{ from: '/user/:id', to: '/users/:id' }]);
    expect(c.views.find((v) => v.name === '/settings')).toMatchObject({ delta: 0, newGaps: 2, resolved: 1 });
  });

  it('reports threshold status changes', () => {
    expect(c.thresholdChanges).toEqual([
      { scope: 'overall', required: 50, head: { actual: 40, status: 'failed' } },
      { scope: 'view', view: '/settings', required: 30, base: { actual: 33.3, status: 'passed' } },
    ]);
    expect(c.failedThresholds).toEqual({ base: 0, head: 1 });
  });

  it('finds nothing between identical runs', () => {
    const same = compareReports(base, base);
    expect(same.delta).toBe(0);
    expect(same.newGaps).toEqual([]);
    expect(same.views.every((v) => v.status === 'unchanged')).toBe(true);
    expect(same.thresholdChanges).toEqual([]);
  });
});

describe('markdown', () => {
  it('escapes text and code', () => {
    expect(mdText('a *b* <c> | [d]')).toBe('a \\*b\\* \\<c\\> \\| \\[d\\]');
    expect(mdCode('main > a')).toBe('`main > a`');
    expect(mdCode('a`b')).toBe('``a`b``');
    expect(mdCode('`x')).toBe('`` `x ``');
    expect(mdCode('a|b', true)).toBe('`a\\|b`');
  });

  it('renders a comparison for a sticky comment', () => {
    const md = comparisonMarkdown(compareReports(base, head), { reportUrl: 'https://example.com/r/index.html' });
    expect(md.startsWith(`${MARKDOWN_MARKER}\n### UI coverage: 40% (-4.4 pp)`)).toBe(true);
    expect(md).toContain('**4 new untested elements** · 1 resolved · 1 view added · 1 view removed · 1 view renamed · thresholds: **1 failing** (was 0)');
    expect(md).toContain('**Views changed (4), 1 unchanged**');
    expect(md).toContain('| [`/users/:id`](https://example.com/r/index.html#%2Fusers%2F%3Aid) (was `/user/:id`) | 33.3% (1/3) | 33.3% (1/3) | ±0 pp | 0 | 0 |');
    expect(md).toContain('- [`/settings`](https://example.com/r/index.html#%2Fsettings) button "save" (was tested) `save`');
    expect(md).toContain('- overall: **failed (40% < 50%)**, was not checked');
    // Deterministic: same input, same text.
    expect(comparisonMarkdown(compareReports(base, head))).toBe(comparisonMarkdown(compareReports(base, head)));
    expect(md).toMatchSnapshot();
  });

  it('collapses and truncates long lists', () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${String(i).padStart(2, '0')}`, false]));
    const md = comparisonMarkdown(compareReports(makeReport({ '/a': {} }), makeReport({ '/a': many })), { maxItems: 20 });
    expect(md).toContain('<details><summary><b>New untested elements (30)</b></summary>');
    expect(md).toContain('- … and 10 more (see the report)');
  });

  it('says so when nothing changed', () => {
    const md = comparisonMarkdown(compareReports(base, base));
    expect(md).toContain('no new untested elements · 0 resolved');
    expect(md).toContain('All 4 views unchanged.');
    expect(md).not.toContain('<details>');
  });

  it('renders one run for the step summary, with thresholds and baseline', () => {
    const r = structuredClone(head);
    r.baseline = {
      file: '../ui-coverage-baseline.json',
      mode: 'check',
      status: 'failed',
      nextFile: '../ui-coverage-baseline.next.json',
      allowNewViews: false,
      newGaps: [{ view: '/settings', kind: 'element', key: 'save', label: 'button "save"', newView: false }],
      resolved: [],
      addedViews: [],
      removedViews: [],
      renamedViews: [],
    };
    const md = reportMarkdown(r);
    expect(md).toContain('### UI coverage: 40% (4/10)');
    expect(md).toContain('| `/settings` | 33.3% | 1/3 |');
    expect(md).toContain('| `/checkout` | 0% | 0/2 |');
    expect(md).toContain('**Thresholds: 1 failing**\n- overall: 40% < 50%');
    expect(md).toContain('**Baseline: failed**, 1 new untested element not in `../ui-coverage-baseline.json`.');
    expect(md).toContain('- `/settings` button "save" `save`');
  });
});
