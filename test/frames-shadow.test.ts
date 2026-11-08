// Frames and shadow roots in the node-side model: tree boundaries in the node
// table, host-chain keys, scoped selectors (`>>`, `documentScope`) and
// frame-aware suggested locators.
import { describe, expect, it } from 'vitest';
import { compileSelector, hostsOf, splitHostChain, type SelectorNode } from '../src/model/selector';
import { resolveCoverageData } from '../src/model/resolve';
import { validateRules } from '../src/model/rules';
import type { RawCoverageData, RawNode } from '../src/model/raw';
import { suggestedLocator } from '../src/locators';

type Tree = [string, Record<string, string>?, Tree[]?];

/** Raw node table from a compact tree; `data-t` attributes name nodes (and are left out of the table). */
function table(tree: Tree) {
  const nodes: RawNode[] = [];
  const byId: Record<string, number> = {};
  const add = ([tag, attrs = {}, children = []]: Tree, parent?: number, nth = 1, of = 1) => {
    const { 'data-t': t, ...rest } = attrs;
    const node: RawNode = { tag };
    if (parent !== undefined) node.parent = parent;
    if (of > 1) Object.assign(node, { nth, of });
    if (Object.keys(rest).length) node.attrs = rest;
    const idx = nodes.push(node) - 1;
    if (t) byId[t] = idx;
    const count: Record<string, number> = {};
    for (const c of children) count[c[0]] = (count[c[0]] ?? 0) + 1;
    const seen: Record<string, number> = {};
    for (const c of children) {
      seen[c[0]] = (seen[c[0]] ?? 0) + 1;
      add(c, idx, seen[c[0]], count[c[0]]);
    }
  };
  add(tree);
  return { nodes, byId };
}

function selectorNodes(nodes: RawNode[]): SelectorNode[] {
  const out: SelectorNode[] = [];
  for (const n of nodes) {
    const node: SelectorNode = { tag: n.tag, attrs: n.attrs ?? {}, nth: n.nth ?? 1, of: n.of ?? 1 };
    if (n.parent !== undefined) node.parent = out[n.parent];
    out.push(node);
  }
  return out;
}

// A page with a web component (open shadow root) and an iframe whose document
// has its own web component.
const PAGE: Tree = ['html', {}, [
  ['body', {}, [
    ['main', { class: 'app' }, [
      ['button', { 'data-t': 'top-btn' }],
      ['promo-banner', { 'data-testid': 'promo', 'data-t': 'promo' }, [
        ['#shadow-root', {}, [
          ['div', { class: 'box' }, [
            ['button', { 'data-testid': 'claim', 'data-t': 'claim' }],
            ['button', { 'data-t': 'dismiss' }],
          ]],
        ]],
      ]],
      ['iframe', { 'data-testid': 'payments', 'data-t': 'frame' }, [
        ['#document', {}, [
          ['html', { 'data-t': 'frame-html' }, [
            ['body', {}, [
              ['form', { id: 'pay' }, [
                ['input', { name: 'card', 'data-t': 'card' }],
                ['brand-picker', { 'data-t': 'picker' }, [
                  ['#shadow-root', {}, [
                    ['div', {}, [
                      ['button', { role: 'radio', 'data-t': 'visa' }],
                      ['button', { role: 'radio', 'data-t': 'mc' }],
                    ]],
                  ]],
                ]],
                ['button', { 'data-uicov-id': 'pay-now', 'data-t': 'pay' }],
              ]],
            ]],
          ]],
        ]],
      ]],
      ['section', { 'data-uicov-ignore': '', 'data-t': 'ignored-section' }, [
        ['my-widget', {}, [['#shadow-root', {}, [['button', { 'data-t': 'ignored-inner' }]]]]],
      ]],
    ]],
  ]],
]];

const { nodes, byId } = table(PAGE);
const sel = selectorNodes(nodes);
const n = (t: string) => sel[byId[t]];
const box = { x: 0, y: 0, w: 10, h: 10 };

function data(): RawCoverageData {
  const ids = ['top-btn', 'claim', 'dismiss', 'card', 'visa', 'mc', 'pay', 'ignored-inner'];
  return {
    formatVersion: 3,
    nodes,
    snapshots: [{ url: 'http://x/', dpr: 1, elements: ids.map((t) => ({ node: byId[t], ...box })) }],
    interactions: [{ event: 'click', url: 'http://x/', element: { node: byId['visa'] } }],
  };
}
const keys = (rules = {}) => resolveCoverageData(data(), rules).snapshots[0].elements.map((e) => e.key);

describe('host chains', () => {
  it('splits at >> outside quotes, brackets and parentheses', () => {
    expect(splitHostChain('iframe#a >> my-widget >>button')).toEqual(['iframe#a', 'my-widget', 'button']);
    expect(splitHostChain('[title="a >> b"] >> :is(a, b)')).toEqual(['[title="a >> b"]', ':is(a, b)']);
    expect(splitHostChain('main > a')).toEqual(['main > a']);
  });

  it('lists the hosts of an element, outermost first', () => {
    expect(hostsOf(n('visa'))).toEqual([n('frame'), n('picker')]);
    expect(hostsOf(n('top-btn'))).toEqual([]);
  });
});

describe('selectors across tree boundaries', () => {
  it("combinators don't cross shadow roots or frames", () => {
    expect(compileSelector('promo-banner button').matches(n('claim'))).toBe(false);
    expect(compileSelector('main button').matches(n('top-btn'))).toBe(true);
    expect(compileSelector('main input').matches(n('card'))).toBe(false);
    expect(compileSelector('form input').matches(n('card'))).toBe(true);
    expect(compileSelector('.box > button').matches(n('claim'))).toBe(true);
  });

  it('unscoped selectors match in every tree; :root matches each document', () => {
    expect(compileSelector('[data-testid="claim"]').matches(n('claim'))).toBe(true);
    expect(compileSelector(':root').matches(sel[0])).toBe(true);
    expect(compileSelector(':root').matches(n('frame-html'))).toBe(true);
    expect(compileSelector('*').matches(sel[byId['frame-html'] - 1])).toBe(false); // #document
  });

  it('a host chain restricts the trees, with >> or documentScope', () => {
    const scoped = compileSelector('[data-testid="payments"] >> button');
    expect(scoped.matches(n('visa'))).toBe(true); // nested deeper: hosts match in order, not necessarily directly
    expect(scoped.matches(n('pay'))).toBe(true);
    expect(scoped.matches(n('claim'))).toBe(false);
    expect(scoped.matches(n('top-btn'))).toBe(false);
    expect(compileSelector('button', 'iframe >> brand-picker').matches(n('visa'))).toBe(true);
    expect(compileSelector('button', 'iframe >> brand-picker').matches(n('pay'))).toBe(false);
    expect(compileSelector('button', 'brand-picker >> iframe').matches(n('visa'))).toBe(false); // wrong order
    expect(compileSelector('div > button', 'promo-banner').matches(n('dismiss'))).toBe(true);
  });

  it('rejects empty parts', () => {
    expect(() => compileSelector('a >> ')).toThrow(/empty/);
    expect(() => compileSelector('a', ' ')).toThrow(/documentScope/);
  });
});

describe('keys and frames', () => {
  it('prefixes keys with the host chain', () => {
    expect(keys()).toEqual([
      'main > button',
      '[data-testid="promo"] >> [data-testid="claim"]',
      '[data-testid="promo"] >> div > button:nth-of-type(2)', // positional: up to the shadow root's top
      '[data-testid="payments"] >> [name="card"]',
      '[data-testid="payments"] >> #pay > brand-picker >> div > button:nth-of-type(1)',
      '[data-testid="payments"] >> #pay > brand-picker >> div > button:nth-of-type(2)',
      'pay-now', // data-uicov-id: as-is
      // ignored-inner: inside [data-uicov-ignore], across the shadow boundary
    ]);
  });

  it('interactions resolve to the inventory key, with frames', () => {
    const out = resolveCoverageData(data());
    expect(out.interactions[0].key).toBe('[data-testid="payments"] >> #pay > brand-picker >> div > button:nth-of-type(1)');
    expect(out.interactions[0].frames).toEqual(['[data-testid="payments"]']);
    expect(out.snapshots[0].elements[1].frames).toBeUndefined(); // shadow roots aren't frames
  });

  it('ignoreSelectors: hosts exclude their content; documentScope targets it', () => {
    expect(keys({ ignoreSelectors: ['promo-banner'] })).not.toContain('[data-testid="promo"] >> [data-testid="claim"]');
    const k = keys({ ignoreSelectors: [{ selector: 'button', documentScope: '[data-testid="payments"]' }] });
    expect(k.filter((x) => x.startsWith('[data-testid="payments"]'))).toEqual(['[data-testid="payments"] >> [name="card"]']);
    expect(k).not.toContain('pay-now');
    expect(k).toContain('main > button');
    expect(keys({ ignoreSelectors: ['iframe >> brand-picker >> button'] })).toHaveLength(5);
  });

  it('reads version 2 recordings', () => {
    expect(resolveCoverageData({ ...data(), formatVersion: 2 }).snapshots[0].elements).toHaveLength(7);
    expect(() => resolveCoverageData({ ...data(), formatVersion: 99 })).toThrow(/formatVersion 99/);
  });

  it('validateRules checks scoped selectors', () => {
    expect(() => validateRules({ ignoreSelectors: [{ selector: 'a', documentScope: 'iframe' }] })).not.toThrow();
    expect(() => validateRules({ ignoreSelectors: [{ selector: 'a:has(b)' }] })).toThrow(/:has/);
    expect(() => validateRules({ ignoreSelectors: [{ documentScope: 'x' } as any] })).toThrow(/selector/);
    expect(() => validateRules({ ignoreSelectors: [{ selector: 'a', documentScope: 3 } as any] })).toThrow(/documentScope/);
  });
});

describe('suggested locators in frames and shadow roots', () => {
  const el = (o: object) => ({ key: '#x', label: 'button', tag: 'button', instances: 1, attrs: {}, ...o });
  it('enters frames with frameLocator', () => {
    expect(
      suggestedLocator(el({ key: '[data-testid="payments"] >> [data-testid="card"]', tag: 'input', attrs: { 'data-testid': 'card' }, frames: ['[data-testid="payments"]'], role: 'textbox', name: '', nameFrom: '' })),
    ).toBe("await page.frameLocator('[data-testid=\"payments\"]').getByTestId('card').fill('…');");
    expect(
      suggestedLocator(el({ key: 'main > iframe >> #inner >> div > button', frames: ['main > iframe', 'main > iframe >> #inner'], role: 'button', name: '', nameFrom: '' })),
    ).toBe("await page.frameLocator('body > main > iframe').frameLocator('#inner').locator('body > div > button').click();");
  });
  it('chains shadow hosts with >>', () => {
    expect(suggestedLocator(el({ key: 'promo-banner >> div > button:nth-of-type(2)', role: 'button', name: '', nameFrom: '' }))).toBe(
      "await page.locator('body > promo-banner >> div > button:nth-of-type(2)').click();",
    );
  });
});
