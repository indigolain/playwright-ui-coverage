// The walkthrough names which instance of a repeated element a step acted on
// ("row 2 of 3 · #user-2") and outlines only that one when an identity tells
// it apart. Built from raw recordings, so the exact places come from the resolver.
import { describe, expect, it } from 'vitest';
import { aggregate, defaultNormalizeUrl } from '../src/aggregate';
import { renderLazyFiles } from '../src/html';
import type { RawCoverageData, RawElement, RawNode, RawSnapshot } from '../src/model/raw';
import { resolveCoverageData } from '../src/model/resolve';
import { instanceHint } from '../src/steps';

const URL = 'http://x/page';
const opts = { normalizeUrl: defaultNormalizeUrl, maxScreenshotsPerRoute: 3 };

/** A node table built by hand: `add` returns the new node's index. */
function table() {
  const nodes: RawNode[] = [];
  const add = (tag: string, parent?: number, extra: Omit<RawNode, 'tag' | 'parent'> = {}) => {
    nodes.push({ tag, ...(parent !== undefined ? { parent } : {}), ...extra });
    return nodes.length - 1;
  };
  const body = add('body', add('html'));
  return { nodes, add, body };
}

const at = (node: number, i: number, name = 'Delete'): RawElement => ({ node, name, nameFrom: 'text', x: 0, y: i * 20, w: 10, h: 10 });
const shot = (name: string, elements: RawElement[], t: number): RawSnapshot => ({ url: URL, dpr: 1, elements, screenshot: name, hash: name, t });

/** A test that loads the page (state `before`), then clicks `target` (state `after`). */
function run(nodes: RawNode[], before: RawElement[], target: RawElement, after: RawElement[] = before) {
  const raw: RawCoverageData = {
    formatVersion: 4,
    nodes,
    snapshots: [shot('inv', before, 1)],
    interactions: [{ event: 'click', url: URL, element: target }],
    states: [shot('before', before, 1), shot('after', after, 3)],
    steps: [
      { t: 1, event: 'load', url: URL, state: 0 },
      { t: 2, event: 'click', url: URL, element: target, state: 1 },
    ],
  };
  const summary = aggregate([{ title: 't', testId: 't', data: resolveCoverageData(raw) }], opts);
  const step = summary.attempts![0].steps[1];
  const boxes = summary.routes[0].states![0].boxes;
  return { summary, step, boxes };
}

/** `<table><tbody>` with a row per entry of `rows` (its attributes), each with a Delete button. */
function rows(rowAttrs: (Record<string, string> | undefined)[]) {
  const { nodes, add, body } = table();
  const tbody = add('tbody', add('table', body));
  const buttons = rowAttrs.map((attrs, i) => {
    const tr = add('tr', tbody, { nth: i + 1, of: rowAttrs.length, ...(attrs ? { attrs } : {}) });
    return add('button', add('td', tr));
  });
  return { nodes, buttons, elements: buttons.map((b, i) => at(b, i)) };
}

describe('walkthrough: the instance a step acted on', () => {
  it('names the row and outlines only it when the row has its own identity', () => {
    const t = rows([{ id: 'user-1' }, { id: 'user-2' }, { id: 'user-3' }]);
    const { step, boxes } = run(t.nodes, t.elements, t.elements[1]);
    expect(step.instance).toBe('row 2 of 3 · #user-2');
    expect(step.box).toBeDefined();
    expect(boxes[step.box!]).toMatchObject({ key: step.key, y: 20 });
    // All three are one element of the report.
    expect(new Set(boxes.map((b) => b.key)).size).toBe(1);
  });

  it('finds the record again after the rows moved (a row above was deleted)', () => {
    const t = rows([{ id: 'user-1' }, { id: 'user-2' }, { id: 'user-3' }]);
    // The screenshot before the step shows #user-2 first: positions changed, identities didn't.
    const later = rows([{ id: 'user-2' }, { id: 'user-3' }]);
    const offset = t.nodes.length;
    const nodes = [...t.nodes, ...later.nodes.map((n) => (n.parent !== undefined ? { ...n, parent: n.parent + offset } : n))];
    const before = later.elements.map((e) => ({ ...e, node: e.node + offset }));
    const { step, boxes } = run(nodes, before, t.elements[1]);
    expect(step.instance).toBe('row 2 of 3 · #user-2');
    expect(boxes[step.box!]).toMatchObject({ y: 0 });
  });

  it('names the position but outlines every row when rows have no identity', () => {
    const t = rows([undefined, undefined, undefined]);
    const { step } = run(t.nodes, t.elements, t.elements[1]);
    expect(step.instance).toBe('row 2 of 3');
    expect(step.box).toBeUndefined();
  });

  it('shows no identity that every row has', () => {
    const t = rows([{ 'data-testid': 'row-1x' }, { 'data-testid': 'row-1x' }, { 'data-testid': 'row-1x' }]);
    const { step } = run(t.nodes, t.elements, t.elements[2]);
    expect(step.instance).toBe('row 3 of 3');
    expect(step.box).toBeUndefined();
  });

  it('gives no hint when the page showed the element once', () => {
    const t = rows([{ id: 'user-1' }, { id: 'user-2' }]);
    const { step } = run(t.nodes, [t.elements[1]], t.elements[1]);
    expect(step.instance).toBeUndefined();
    expect(step.box).toBeUndefined();
  });

  it('uses aria-rowindex and the grid’s aria-rowcount for role="row"', () => {
    const { nodes, add, body } = table();
    const grid = add('div', body, { attrs: { role: 'grid', 'aria-rowcount': '50' } });
    const els = [12, 13].map((n, i) => {
      const row = add('div', grid, { nth: i + 1, of: 2, attrs: { role: 'row', 'aria-rowindex': String(n) } });
      return at(add('button', add('div', row, { attrs: { role: 'gridcell' } })), i);
    });
    expect(run(nodes, els, els[1]).step.instance).toBe('row 13 of 50');
  });

  it('leaves out the position of a row in a table with several <tbody>', () => {
    const { nodes, add, body } = table();
    const tableNode = add('table', body);
    const els: RawElement[] = [];
    for (const b of [1, 2]) {
      const tbody = add('tbody', tableNode, { nth: b, of: 2 });
      for (const r of [1, 2]) els.push(at(add('button', add('td', add('tr', tbody, { nth: r, of: 2 }))), els.length));
    }
    // Rows are numbered per body: "row 2 of 2" isn't a place people could check, and there's nothing else to name.
    expect(run(nodes, els, els[1]).step.instance).toBeUndefined();
  });

  it('names the outer row first in a nested table', () => {
    const { nodes, add, body } = table();
    const outer = add('tbody', add('table', body));
    const els: RawElement[] = [];
    for (const o of [1, 2]) {
      const orow = add('tr', outer, { nth: o, of: 2 });
      const inner = add('tbody', add('table', add('td', orow)));
      for (const r of [1, 2]) els.push(at(add('button', add('td', add('tr', inner, { nth: r, of: 2 }))), els.length));
    }
    const { step } = run(nodes, els, els[2]);
    expect(step.instance).toBe('row 2 of 2 › row 1 of 2');
    expect(step.box).toBeUndefined();
  });

  it('names the card of a repeated structure, and the element’s own identity', () => {
    const { nodes, add, body } = table();
    const list = add('div', body, { attrs: { class: 'products' } });
    const els = [1, 2, 3].map((n, i) => {
      const card = add('div', list, { nth: n, of: 3, attrs: { class: 'card', 'data-testid': `product-${n}` } });
      add('h2', card);
      return at(add('button', card, { attrs: { 'data-testid': `add-to-cart-${n}` } }), i, 'Add to cart');
    });
    const { step, boxes } = run(nodes, els, els[1]);
    expect(step.instance).toBe('item 2 of 3 · [data-testid="product-2"] · [data-testid="add-to-cart-2"]');
    expect(boxes[step.box!]).toMatchObject({ y: 20 });
  });

  it('names an element that is itself the repeated item (the stars of a rating)', () => {
    const { nodes, add, body } = table();
    const rating = add('div', body, { attrs: { 'data-uicov-group': 'rating' } });
    const els = [1, 2, 3, 4, 5].map((n, i) => at(add('button', rating, { nth: n, of: 5 }), i, `${n} stars`));
    const { step } = run(nodes, els, els[3]);
    expect(step.instance).toBe('item 4 of 5');
    expect(step.box).toBeUndefined();
  });

  it('only compares instances of the same element', () => {
    const own = [{ tag: 'div', nth: 1, of: 2, pos: 1, count: 2 }, { tag: 'button' }];
    const other = [{ tag: 'div', nth: 2, of: 2, pos: 2, count: 2 }, { tag: 'button' }];
    const snap = { elements: [{ key: 'b', instance: other }, { key: 'c', instance: other }] as any };
    expect(instanceHint({ key: 'b', instance: own }, snap)?.text).toBe('item 1 of 2');
    expect(instanceHint({ key: 'c2', instance: own }, snap)).toBeUndefined();
  });

  it('puts the hint and the box into the walkthrough file, not into coverage.json', () => {
    const t = rows([{ id: 'user-1' }, { id: 'user-2' }]);
    const { summary } = run(t.nodes, t.elements, t.elements[0]);
    const file = renderLazyFiles(summary).get('test-0.js')!;
    expect(file).toContain('"instance":"row 1 of 2 · #user-1"');
    expect(file).toContain('"before":"0.1","after":"0.2","box":0');
    expect(JSON.stringify(summary.routes[0].states)).not.toContain('"instance"');
  });
});
