// Element grouping (README "Element grouping"): explicit groups (markup and
// `elementGroups`) and the automatic heuristics (form boundary, table rows,
// repeated structures, labels), from raw recordings to aggregated views.
import { describe, expect, it } from 'vitest';
import { aggregate, defaultNormalizeUrl, type RouteCoverage } from '../src/aggregate';
import { resolveCoverageData } from '../src/model/resolve';
import { validateRules, type UiCoverageRules } from '../src/model/rules';
import { repeatedKey } from '../src/grouping';
import type { RawCoverageData, RawElement, RawNode } from '../src/model/raw';

/** [tag, attrs, children]. `data-n` gives a recorded element its accessible name (and records it). */
type Tree = [string, Record<string, string>?, Tree[]?];
const URL_ = 'http://x.test/page';

/** One recording of `tree`; `interact` lists `data-t` names of elements clicked. */
function recording(tree: Tree, interact: string[] = [], interactionNames: Record<string, string> = {}): RawCoverageData {
  const nodes: RawNode[] = [];
  const elements: RawElement[] = [];
  const byT: Record<string, number> = {};
  const add = ([tag, attrs = {}, children = []]: Tree, parent?: number, nth = 1, of = 1) => {
    const { 'data-t': t, 'data-n': name, ...rest } = attrs;
    const node: RawNode = { tag };
    if (parent !== undefined) node.parent = parent;
    if (of > 1) Object.assign(node, { nth, of });
    if (Object.keys(rest).length) node.attrs = rest;
    const idx = nodes.push(node) - 1;
    if (t) byT[t] = idx;
    if (name !== undefined) elements.push({ node: idx, name, nameFrom: 'text', x: 0, y: elements.length * 10, w: 10, h: 10 });
    const count: Record<string, number> = {};
    for (const c of children) count[c[0]] = (count[c[0]] ?? 0) + 1;
    const seen: Record<string, number> = {};
    for (const c of children) {
      seen[c[0]] = (seen[c[0]] ?? 0) + 1;
      add(c, idx, seen[c[0]], count[c[0]]);
    }
  };
  add(tree);
  return {
    formatVersion: 3,
    nodes,
    snapshots: [{ url: URL_, dpr: 1, elements }],
    interactions: interact.map((t) => ({
      event: 'click',
      url: URL_,
      element: { node: byT[t], name: interactionNames[t] ?? elements.find((e) => e.node === byT[t])?.name, nameFrom: 'text' },
    })),
  };
}

const page = (...body: Tree[]): Tree => ['html', {}, [['body', {}, body]]];

function view(recordings: RawCoverageData[], rules: UiCoverageRules = {}): RouteCoverage {
  const tests = recordings.map((data, i) => ({ title: `t${i}`, data: resolveCoverageData(data, rules) }));
  const summary = aggregate(tests, { normalizeUrl: defaultNormalizeUrl, maxScreenshotsPerRoute: 1 });
  return summary.routes[0];
}
const brief = (r: RouteCoverage) =>
  r.elements
    .map((e) => ({ key: e.key, instances: e.instances, tested: e.tested, ...(e.group ? { group: e.group } : {}) }))
    .sort((a, b) => a.key.localeCompare(b.key));

const card = (i: number, extra: Record<string, string> = {}): Tree => [
  'li',
  { class: 'card' },
  [
    ['h3', {}],
    ['div', { class: 'card-footer' }, [
      ['button', { class: 'btn primary', 'data-n': 'Add to cart', 'data-t': `add${i}`, ...extra }],
      ['button', { class: 'btn', 'data-n': 'Details' }],
    ]],
  ],
];

describe('repeated structures', () => {
  it('groups the same control of repeated cards, counted once, tested through any member', () => {
    const tree = page(['main', {}, [['ul', { class: 'products' }, [card(1), card(2), card(3)]]]]);
    const r = view([recording(tree, ['add2'])]);
    expect(brief(r)).toEqual([
      { key: 'main > ul > li > div > button:nth-of-type(1)', instances: 3, tested: true, group: { reason: 'repeated', members: 3 } },
      { key: 'main > ul > li > div > button:nth-of-type(2)', instances: 3, tested: false, group: { reason: 'repeated', members: 3 } },
    ]);
    expect(r.total).toBe(2);
    expect(r.tested).toBe(1);
  });

  it('anchors the key at an ancestor identity all members share, ignores per-instance ids', () => {
    const tree = page(['main', {}, [
      ['ul', { 'data-testid': 'products' }, [
        card(1, { 'data-testid': 'add-1' }),
        card(2, { 'data-testid': 'add-2' }),
      ]],
    ]]);
    const keys = brief(view([recording(tree)])).map((e) => e.key);
    expect(keys).toContain('[data-testid="products"] > li > div > button:nth-of-type(1)');
  });

  it('keeps elements apart that have different names, meaningful distinct ids, or are links or in navigation', () => {
    const panel = (testid: string): Tree => ['div', { class: 'panel' }, [['button', { 'data-testid': testid, 'data-n': 'Edit' }]]];
    const tree = page(
      ['main', {}, [panel('profile-edit'), panel('billing-edit')]],
      ['div', { role: 'toolbar' }, [
        ['span', {}, [['button', { 'data-n': 'Bold' }]]],
        ['span', {}, [['button', { 'data-n': 'Bold' }]]],
      ]],
      ['section', {}, [
        ['p', {}, [['a', { href: '/a', 'data-n': 'More' }]]],
        ['p', {}, [['a', { href: '/b', 'data-n': 'More' }]]],
      ]],
    );
    const r = view([recording(tree)]);
    expect(r.total).toBe(6);
    expect(r.elements.every((e) => !e.group)).toBe(true);
  });

  it('needs two members, also across tests; an interaction with another name still counts', () => {
    const one = page(['main', {}, [['ul', {}, [card(1)]]]]);
    expect(brief(view([recording(one)])).map((e) => e.key)).toEqual(['main > ul > li > div > button:nth-of-type(1)', 'main > ul > li > div > button:nth-of-type(2)']);
    const two = page(['main', {}, [['ul', {}, [card(1), card(2)]]]]);
    const r = view([recording(one), recording(two, ['add2'], { add2: 'Added!' })]);
    expect(r.total).toBe(2);
    expect(r.elements.find((e) => e.key.endsWith('button:nth-of-type(1)'))!.tested).toBe(true);
  });

  it('autoGroup: false and { repeated: false } turn it off; data-uicov-group="" opts out', () => {
    const tree = page(['main', {}, [['ul', {}, [card(1), card(2)]]]]);
    expect(view([recording(tree)], { autoGroup: false }).total).toBe(4);
    expect(view([recording(tree)], { autoGroup: { repeated: false } }).total).toBe(4);
    const optOut = page(['main', { 'data-uicov-group': '' }, [['ul', {}, [card(1), card(2)]]]]);
    expect(view([recording(optOut)]).total).toBe(4);
  });

  it('works across shadow roots of repeated components; markup groups need no host prefix', () => {
    const component = (attrs: Record<string, string> = {}): Tree => ['product-card', {}, [
      ['#shadow-root', {}, [['div', { class: 'actions' }, [['button', { 'data-n': 'Add', ...attrs }]]]]],
    ]];
    expect(brief(view([recording(page(['main', {}, [component(), component()]]))]))).toEqual([
      { key: 'main > product-card >> div > button', instances: 2, tested: false, group: { reason: 'repeated', members: 2 } },
    ]);
    const marked = page(['main', {}, [component({ 'data-uicov-group': 'add' }), component({ 'data-uicov-group': 'add' })]]);
    expect(brief(view([recording(marked)])).map((e) => e.key)).toEqual(['[data-uicov-group="add"]']);
  });

  it('repeatedKey keeps an index only where all members agree', () => {
    const lv = (li: number) => [
      { step: 'ul', tag: 'ul', anchor: '#list', sep: ' > ' },
      { step: `li:nth-of-type(${li})`, tag: 'li', sep: ' > ' },
      { step: 'button:nth-of-type(2)', tag: 'button', sep: ' > ' },
    ];
    expect(repeatedKey([lv(1), lv(2)])).toBe('#list > li > button:nth-of-type(2)');
  });
});

describe('form boundary', () => {
  const form = (id: string, action: string): Tree => ['form', { id, action }, [
    ['input', { name: 'email', 'data-n': 'Email' }],
    ['button', { 'data-testid': 'submit', 'data-n': 'Submit', 'data-t': `${id}-submit` }],
  ]];

  it('the same attribute in different forms is one element per form', () => {
    const tree = page(['main', {}, [form('login', '/login'), form('signup', '/signup')]]);
    const r = view([recording(tree, ['login-submit'])]);
    expect(brief(r).map((e) => [e.key, e.tested])).toEqual([
      ['#login [data-testid="submit"]', true],
      ['#login [name="email"]', false],
      ['#signup [data-testid="submit"]', false],
      ['#signup [name="email"]', false],
    ]);
  });

  it('keys stay as they are without a conflict, or with forms: false', () => {
    const tree = page(['main', {}, [form('login', '/login')]]);
    expect(brief(view([recording(tree)])).map((e) => e.key)).toEqual(['[data-testid="submit"]', '[name="email"]']);
    const both = page(['main', {}, [form('login', '/login'), form('signup', '/signup')]]);
    const r = view([recording(both)], { autoGroup: { forms: false } });
    expect(brief(r)).toEqual([
      { key: '[data-testid="submit"]', instances: 2, tested: false, group: { reason: 'same-key', members: 1 } },
      { key: '[name="email"]', instances: 2, tested: false, group: { reason: 'same-key', members: 1 } },
    ]);
  });

  it('identically shaped forms are not merged as repeated structures', () => {
    const anon = (action: string): Tree => ['div', { class: 'box' }, [['form', { action }, [['button', { 'data-n': 'Submit' }]]]]];
    const r = view([recording(page(['main', {}, [anon('/login'), anon('/signup')]]))]);
    expect(r.total).toBe(2);
  });
});

describe('table rows', () => {
  const row = (i: number): Tree => ['tr', { 'row-id': String(i) }, [
    ['td', {}, [['button', { id: `edit-${i}`, 'data-n': `Edit user ${i}`, 'data-t': `edit${i}` }]]],
    ['td', {}, [['button', { 'data-action': 'delete', 'data-n': 'Delete' }]]],
  ]];
  const tree = page(['main', {}, [['table', { 'data-testid': 'users' }, [['tbody', {}, [row(1), row(2), row(3)]]]]]]);

  it('groups the same column across rows, whatever the controls are called', () => {
    const r = view([recording(tree, ['edit3'])], { significantAttributes: ['data-action'] });
    expect(brief(r)).toEqual([
      { key: '[data-action="delete"]', instances: 3, tested: false, group: { reason: 'row', members: 1 } },
      { key: '[data-testid="users"] > tbody > tr > td:nth-of-type(1) > button', instances: 3, tested: true, group: { reason: 'row', members: 3 } },
    ]);
  });

  it('works for role=grid and turns off with rows: false (rows get an index)', () => {
    const grid = page(['div', { role: 'grid' }, [
      ['div', { role: 'row' }, [['div', { role: 'gridcell' }, [['button', { 'data-n': 'Open' }]]]]],
      ['div', { role: 'row' }, [['div', { role: 'gridcell' }, [['button', { 'data-n': 'Open' }]]]]],
    ]]);
    expect(brief(view([recording(grid)]))).toEqual([
      { key: 'div > div > div > button', instances: 2, tested: false, group: { reason: 'row', members: 1 } },
    ]);
    // Without the row heuristic, the "Delete" buttons are still repeated structures.
    expect(view([recording(tree)], { autoGroup: { rows: false } }).total).toBe(4);
    expect(view([recording(tree)], { autoGroup: { rows: false, repeated: false } }).total).toBe(6);
    expect(brief(view([recording(grid)], { autoGroup: { rows: false, repeated: false } })).map((e) => e.key)).toEqual([
      'div > div:nth-of-type(1) > div > button',
      'div > div:nth-of-type(2) > div > button',
    ]);
  });
});

describe('labels', () => {
  it('a counted label joins its control', () => {
    const tree = page(['main', {}, [
      ['label', { for: 'qty', tabindex: '0', 'data-n': 'Quantity', 'data-t': 'label' }],
      ['input', { id: 'qty', 'data-n': 'Quantity' }],
      ['label', { tabindex: '0', 'data-n': 'Gift' }, [['input', { type: 'checkbox', name: 'gift', 'data-n': 'Gift' }]]],
    ]]);
    const r = view([recording(tree, ['label'])]);
    expect(brief(r)).toEqual([
      { key: '[name="gift"]', instances: 1, tested: false, group: { reason: 'label', members: 2 } },
      { key: '#qty', instances: 1, tested: true, group: { reason: 'label', members: 2 } },
    ]);
    expect(view([recording(tree)], { autoGroup: { labels: false } }).total).toBe(4);
  });
});

describe('explicit groups', () => {
  it('data-uicov-group on a wrapper or on the elements: one element per name, even alone', () => {
    const tree = page(['main', {}, [
      ['div', { 'data-uicov-group': 'product card' }, [['span', {}, [['button', { id: 'buy-a', 'data-n': 'Buy A', 'data-t': 'a' }]]]]],
      ['div', { 'data-uicov-group': 'product card' }, [['span', {}, [['button', { id: 'buy-b', 'data-n': 'Buy B' }]]]]],
      ['button', { 'data-uicov-group': 'help', 'data-n': 'Help' }],
    ]]);
    const r = view([recording(tree, ['a'])]);
    expect(brief(r)).toEqual([
      { key: '[data-uicov-group="help"]', instances: 1, tested: false, group: { name: 'help', reason: 'markup', members: 1 } },
      { key: '[data-uicov-group="product card"]', instances: 2, tested: true, group: { name: 'product card', reason: 'markup', members: 2 } },
    ]);
  });

  it('elementGroups: first match wins, markup wins over config, exclude opts out', () => {
    const tree = page(['main', {}, [
      ['section', { class: 'promo' }, [['button', { 'data-testid': 'p1', 'data-n': 'Claim' }], ['button', { 'data-testid': 'p2', 'data-n': 'Later' }]]],
      ['section', { class: 'promo', 'data-uicov-group': 'special' }, [['button', { 'data-testid': 'p3', 'data-n': 'Claim' }]]],
      ['ul', {}, [card(1), card(2)]],
    ]]);
    const rules: UiCoverageRules = {
      elementGroups: [
        { selector: '.promo button', name: 'promo buttons' },
        { selector: 'section' },
        { selector: '.card', exclude: true },
      ],
    };
    expect(brief(view([recording(tree)], rules))).toEqual([
      { key: '.promo button', instances: 2, tested: false, group: { name: 'promo buttons', reason: 'config', members: 2 } },
      { key: '[data-uicov-group="special"]', instances: 1, tested: false, group: { name: 'special', reason: 'markup', members: 1 } },
      { key: 'main > ul > li:nth-of-type(1) > div > button:nth-of-type(1)', instances: 1, tested: false },
      { key: 'main > ul > li:nth-of-type(1) > div > button:nth-of-type(2)', instances: 1, tested: false },
      { key: 'main > ul > li:nth-of-type(2) > div > button:nth-of-type(1)', instances: 1, tested: false },
      { key: 'main > ul > li:nth-of-type(2) > div > button:nth-of-type(2)', instances: 1, tested: false },
    ]);
  });

  it('validates the new rule keys', () => {
    expect(() => validateRules({ elementGroups: [{ selector: 'a + b' }] })).toThrow(/elementGroups\[0\]/);
    expect(() => validateRules({ elementGroups: [{ name: 'x' } as any] })).toThrow(/selector: is required/);
    expect(() => validateRules({ autoGroup: { row: false } as any })).toThrow(/did you mean "rows"/);
    expect(() => validateRules({ autoGroup: 'yes' as any })).toThrow(/autoGroup/);
    expect(() =>
      validateRules({ autoGroup: { rows: false }, elementGroups: [{ selector: 'button', documentScope: 'my-widget', name: 'w', comment: 'c' }] }),
    ).not.toThrow();
  });
});
