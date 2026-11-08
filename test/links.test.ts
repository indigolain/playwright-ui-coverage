import { describe, expect, it } from 'vitest';
import { aggregate, classifyLink, defaultNormalizeUrl, type TestEntry } from '../src/aggregate';
import { toCoverageReport } from '../src/coverage-report';
import { renderHtml } from '../src/html';
import { addSuggestedLocators } from '../src/locators';
import { validateRules } from '../src/model/rules';
import { checkBaseline, createBaseline } from '../src/baseline';
import { compareReports } from '../src/compare';
import { comparisonMarkdown } from '../src/markdown';
import type { InventoryElement, Snapshot } from '../src/types';

const ORIGIN = 'http://app.test';
const a = (key: string, href: string, name = key, extra: Partial<InventoryElement> = {}): InventoryElement => ({
  key, label: `link "${name}"`, tag: 'a', role: 'link', name, nameFrom: 'text', attrs: { href }, x: 0, y: 0, w: 10, h: 10, ...extra,
});
const button = (key: string): InventoryElement => ({ key, label: `button "${key}"`, tag: 'button', x: 0, y: 20, w: 10, h: 10 });
const page = (path: string, elements: InventoryElement[], screenshot?: string): Snapshot => ({ url: ORIGIN + path, dpr: 1, elements, ...(screenshot ? { screenshot } : {}) });
const entry = (title: string, snapshots: Snapshot[], over: Partial<TestEntry> = {}): TestEntry => ({
  title, testId: title, data: { interactions: [], snapshots }, ...over,
});
const opts = { normalizeUrl: defaultNormalizeUrl, maxScreenshotsPerRoute: 3 };

describe('link units', () => {
  const run = (links?: Parameters<typeof aggregate>[1]['links']) =>
    aggregate(
      [
        entry('home', [
          page('/', [
            a('nav-users', '/users', 'Users'),
            a('cta', 'users', 'See users'),
            a('nav-home', '/', 'Home'),
            a('frag', '#top', 'Top'),
            a('hash', '#', 'Hash'),
            a('js', 'javascript:void(0)', 'JS'),
            a('empty', '', 'Empty'),
            a('ext', 'https://example.com/docs', 'Docs'),
            a('audit', '/settings/audit?x=1', 'Audit'),
            button('save'),
          ], 'shot.png'),
        ]),
        entry('users', [page('/users', [a('u1', '/users/1', 'Ada'), a('u2', '/users/2', 'Grace')])]),
      ],
      { ...opts, links },
    );

  it('groups links by destination view and tests them by visits', () => {
    const s = run();
    const home = s.routes.find((r) => r.route === '/')!;
    expect(home.links.map((l) => [l.key, l.tested, l.referrers.map((e) => e.key), l.destinations])).toEqual([
      ['/settings/audit', false, ['audit'], ['/settings/audit?x=1']],
      ['/users', true, ['cta', 'nav-users'], ['/users']],
    ]);
    expect(home.links[1].label).toBe('link "See users" (+1 more)');
    // Same-view, fragment, javascript:, empty and external links stay elements; link <a>s don't.
    expect(home.elements.map((e) => e.key).sort()).toEqual(['empty', 'ext', 'frag', 'hash', 'js', 'nav-home', 'save']);
    expect([home.total, home.tested, home.totalLinks, home.testedLinks]).toEqual([9, 1, 2, 1]);
    // /users → /users/:id: one unit for both rows, untested (never visited).
    const users = s.routes.find((r) => r.route === '/users')!;
    expect(users.links.map((l) => [l.key, l.destinations, l.destinationCount])).toEqual([['/users/:id', ['/users/1', '/users/2'], 2]]);
    expect(s.untestedViews).toEqual([
      { view: '/settings/audit', destinations: ['/settings/audit?x=1'], destinationCount: 1, referrers: [{ route: '/', label: 'link "Audit"', keys: ['audit'] }] },
      { view: '/users/:id', destinations: ['/users/1', '/users/2'], destinationCount: 2, referrers: [{ route: '/users', label: 'link "Ada" (+1 more)', keys: ['u1', 'u2'] }] },
    ]);
    expect([s.total, s.tested, s.totalLinks, s.testedLinks, s.percent]).toEqual([10, 1, 3, 1, 10]);
  });

  it('`links: false` counts every <a> as an element', () => {
    const s = run(false);
    expect(s.routes.every((r) => r.links.length === 0)).toBe(true);
    expect(s.untestedViews).toEqual([]);
    expect(s.routes.find((r) => r.route === '/')!.elements).toHaveLength(10);
  });

  it("`external: 'ignore'` drops external links, and their boxes", () => {
    const s = run({ external: 'ignore' });
    const home = s.routes.find((r) => r.route === '/')!;
    expect(home.elements.map((e) => e.key)).not.toContain('ext');
    expect(home.screenshots[0].boxes.map((b) => b.key)).not.toContain('ext');
    expect(home.screenshots[0].boxes.map((b) => b.key)).toContain('audit');
  });

  it('origins of visited pages are internal', () => {
    const s = aggregate(
      [
        entry('a', [page('/', [a('admin', 'http://admin.test/panel', 'Admin')])]),
        entry('b', [{ url: 'http://admin.test/panel', dpr: 1, elements: [button('x')] }]),
      ],
      opts,
    );
    const home = s.routes.find((r) => r.route === '/')!;
    expect(home.links.map((l) => [l.key, l.tested, l.destinations])).toEqual([['/panel', true, ['http://admin.test/panel']]]);
  });

  it('a view visited only by failing attempts: untested link, not an untested view', () => {
    const s = aggregate(
      [entry('a', [page('/', [a('x', '/x', 'X')])]), entry('b', [page('/x', [button('y')])], { interactions: 'failing' })],
      opts,
    );
    expect(s.routes.find((r) => r.route === '/')!.links[0].tested).toBe(false);
    expect(s.untestedViews).toEqual([]);
  });

  it('keeps links in frames and in component tests as elements', () => {
    const s = aggregate(
      [
        entry('frame', [page('/', [a('f >> a', '/elsewhere', 'In frame', { frames: ['f'] })])]),
        { title: 'ct', data: { interactions: [], snapshots: [page('/', [a('ct-link', '/docs', 'Docs')])], view: 'Button.spec.tsx' } },
      ],
      opts,
    );
    expect(s.routes.flatMap((r) => r.links)).toEqual([]);
    expect(s.routes.flatMap((r) => r.elements.map((e) => e.key)).sort()).toEqual(['ct-link', 'f >> a']);
  });

  it('a key with any link instance is a link referrer; interactions are kept on it', () => {
    const s = aggregate(
      [
        entry('t', [page('/', [a('k', '/a', 'A')]), page('/', [a('k', '#', 'A')])]),
        {
          title: 'click', testId: 'click',
          data: { snapshots: [page('/a', [button('b')])], interactions: [{ key: 'k', label: 'link "A"', event: 'click', url: ORIGIN + '/' }] },
        },
      ],
      opts,
    );
    const home = s.routes.find((r) => r.route === '/')!;
    expect(home.elements).toEqual([]);
    expect(home.links[0].referrers[0]).toMatchObject({ key: 'k', tested: true, testIds: ['click'] });
  });

  it('uses the recorded href (a <base> element) over the attribute', () => {
    const c = classifyLink(a('k', 'x', 'X', { href: ORIGIN + '/base/x' }), ORIGIN + '/page', '/page', {
      viewOf: defaultNormalizeUrl, internal: new Set(), rules: {},
    });
    expect(c).toEqual({ kind: 'link', view: '/base/x', url: '/base/x' });
    // The view mapping can drop a destination (excluded URLs).
    expect(classifyLink(a('k', '/x'), ORIGIN + '/', '/', { viewOf: () => undefined, internal: new Set(), rules: {} })).toEqual({ kind: 'ignore' });
    // tel:/mailto: aren't recorded as interactive; other schemes stay elements.
    expect(classifyLink(a('k', 'ftp://h/x'), ORIGIN + '/', '/', { viewOf: defaultNormalizeUrl, internal: new Set(), rules: {} })).toEqual({ kind: 'element' });
  });

  it('maps to coverage.json, the HTML report, baselines and comparisons', () => {
    const s = run();
    addSuggestedLocators(s);
    const home = s.routes.find((r) => r.route === '/')!;
    expect(home.links[0].referrers[0].suggestedLocator).toBe("await page.getByRole('link', { name: 'Audit' }).click();");
    const report = toCoverageReport(s, []);
    expect(report.summary).toMatchObject({ untestedViewCount: 2, testedLinksCount: 1, untestedLinksCount: 2, testedElementsCount: 0, untestedElementsCount: 7 });
    const view = report.views.find((v) => v.name === '/')!;
    expect(view.summary).toMatchObject({ coverage: 11.1, testedLinksCount: 1, untestedLinksCount: 1, untestedElementsCount: 7 });
    expect(report.untestedViews.map((v) => [v.name, v.referrers.map((r) => r.view)])).toEqual([
      ['/settings/audit', ['/']],
      ['/users/:id', ['/users']],
    ]);

    const html = renderHtml(s);
    expect(html).toContain('"untestedViews":[{"view":"/settings/audit"');
    expect(html).toContain('"linkEls":[');

    const baseline = createBaseline(report);
    expect(baseline.views['/']).toEqual({ untestedElements: ['empty', 'ext', 'frag', 'hash', 'js', 'nav-home', 'save'], untestedLinks: ['/settings/audit'] });
    expect(checkBaseline(baseline, report).newGaps).toEqual([]);

    const before = toCoverageReport(aggregate([entry('home', [page('/', [a('audit', '/settings/audit', 'Audit')])]), entry('audit', [page('/settings/audit', [button('b')])])], opts), []);
    const after = toCoverageReport(aggregate([entry('home', [page('/', [a('audit', '/settings/audit', 'Audit')])])], opts), []);
    const c = compareReports(before, after);
    expect(c.newGaps).toEqual([{ view: '/', kind: 'link', key: '/settings/audit', label: 'link "Audit"', reason: 'regressed' }]);
    expect(comparisonMarkdown(c)).toContain('- `/` link "Audit" → `/settings/audit` (was tested)');
    expect(comparisonMarkdown(c)).toContain('**1 new untested link**');
  });
});

describe('links rule', () => {
  it('validates', () => {
    expect(() => validateRules({ links: false })).not.toThrow();
    expect(() => validateRules({ links: { external: 'ignore', comment: 'x' } })).not.toThrow();
    expect(() => validateRules({ links: true } as never)).toThrow(/links/);
    expect(() => validateRules({ links: { external: 'count' } } as never)).toThrow(/external/);
  });
});
