// The per-test walkthrough: steps of each attempt with the page before and
// after them, links from "Tested by", and the files the page loads on demand.
import { describe, expect, it } from 'vitest';
import { aggregate, defaultNormalizeUrl, type TestEntry } from '../src/aggregate';
import { renderHtml, renderLazyFiles } from '../src/html';
import { resolveCoverageData } from '../src/model/resolve';
import type { RawCoverageData, RawNode, RawSnapshot } from '../src/model/raw';
import type { InventoryElement, Snapshot } from '../src/types';

const el = (key: string, x: number): InventoryElement => ({ key, label: key, tag: 'button', x, y: 0, w: 10, h: 10 });
const clip = { x: 0, y: 0, width: 100, height: 100 };
const state = (name: string, keys: string[], t: number, url = 'http://x/page'): Snapshot => ({
  url,
  dpr: 1,
  screenshot: name,
  elements: keys.map((k, i) => el(k, i * 20)),
  t,
  hash: name,
  screenshotClip: clip,
});

/** A test that loads /page, clicks #one (which shows #two), then clicks #two, which goes to /next. */
const recording = (): TestEntry['data'] => ({
  // /next is a view of the report because an inventory found #three there (states don't count).
  snapshots: [{ url: 'http://x/next', dpr: 1, elements: [el('#three', 0)] }],
  interactions: [
    { key: '#one', label: 'button "One"', event: 'click', url: 'http://x/page' },
    { key: '#two', label: 'button "Two"', event: 'click', url: 'http://x/page' },
  ],
  states: [state('s0', ['#one'], 1), state('s1', ['#one', '#two'], 3), state('s2', ['#three'], 5, 'http://x/next')],
  steps: [
    { t: 1, event: 'load', url: 'http://x/page', state: 0, call: { api: 'page.goto', arg: '/page' } },
    { t: 2, event: 'click', url: 'http://x/page', target: { key: '#one', label: 'button "One"' }, state: 1 },
    { t: 4, event: 'click', url: 'http://x/page', target: { key: '#two', label: 'button "Two"' }, state: 2 },
    { t: 5, event: 'load', url: 'http://x/next' },
  ],
});
const opts = { normalizeUrl: defaultNormalizeUrl, maxScreenshotsPerRoute: 3 };

describe('walkthroughs', () => {
  it('step through each attempt with the page before and after each step', () => {
    const summary = aggregate(
      [
        { title: 't', testId: 't', retry: 0, passed: false, interactions: 'ignore', data: recording() },
        { title: 't', testId: 't', retry: 1, passed: true, data: recording() },
      ],
      opts,
    );
    const [failed, passed] = summary.attempts!;
    expect([failed.retry, failed.passed, failed.steps.length, passed.retry, passed.use]).toEqual([0, false, 4, 1, 'tested']);
    expect(passed.steps.map((s) => [s.event, s.route, s.key, s.before, s.after])).toEqual([
      ['load', '/page', undefined, undefined, { route: '/page', index: 0 }],
      ['click', '/page', '#one', { route: '/page', index: 0 }, { route: '/page', index: 1 }],
      ['click', '/page', '#two', { route: '/page', index: 1 }, { route: '/next', index: 0 }],
      // A load starts a new document: no "before".
      ['load', '/next', undefined, undefined, undefined],
    ]);
    expect(passed.steps[0].call).toEqual({ api: 'page.goto', arg: '/page' });
    const page = summary.routes.find((r) => r.route === '/page')!;
    // Both attempts reached the same states (same hashes).
    expect(page.states!.map((s) => s.attempts)).toEqual([[0, 1], [0, 1]]);
    // "Tested by" → the first step of the counted attempt on the element.
    expect(page.elements.map((e) => [e.key, e.firstStep])).toEqual([
      ['#one', { t: 1 }],
      ['#two', { t: 2 }],
    ]);
  });

  it('merges the recordings (browser contexts) of one attempt in time order', () => {
    const second: TestEntry['data'] = { snapshots: [], interactions: [], steps: [{ t: 3, event: 'load', url: 'http://x/other' }] };
    const summary = aggregate(
      [
        { title: 't', testId: 't', retry: 0, passed: true, data: recording() },
        { title: 't', testId: 't', retry: 0, passed: true, data: second },
      ],
      opts,
    );
    expect(summary.attempts).toHaveLength(1);
    expect(summary.attempts![0].steps.map((s) => `${s.event} ${s.url}`)).toEqual([
      'load http://x/page',
      'click http://x/page',
      'load http://x/other',
      'click http://x/page',
      'load http://x/next',
    ]);
  });

  it('writes each walkthrough into a file loaded on demand, and step links into the page data', () => {
    const summary = aggregate([{ title: 't', testId: 't', retry: 0, passed: true, data: recording() }], opts);
    summary.tests = [{ id: 't', title: 't', run: 0, passed: true }];
    const files = renderLazyFiles(summary);
    expect([...files.keys()].sort()).toEqual(['test-0.js', 'view-0.js', 'view-1.js']);
    let payload: any;
    new Function('__uicovData', files.get('test-0.js')!)((_k: string, _i: number, p: unknown) => (payload = p));
    // Routes are sorted (/next is 0, /page is 1); states are "<route>.<state>", with their boxes.
    expect(payload.steps.map((s: any) => [s.event, s.route, s.key, s.before, s.after])).toEqual([
      ['load', 1, undefined, undefined, '1.0'],
      ['click', 1, '#one', '1.0', '1.1'],
      ['click', 1, '#two', '1.1', '0.0'],
      ['load', 0, undefined, undefined, undefined],
    ]);
    expect(Object.keys(payload.states).sort()).toEqual(['0.0', '1.0', '1.1']);
    expect(payload.states['1.1'].boxes).toEqual([
      [0, 0, 0, 10, 10],
      [1, 20, 0, 10, 10],
    ]);
    const html = renderHtml(summary);
    const data = JSON.parse(html.match(/<script id="data" type="application\/json">(.*?)<\/script>/s)![1]);
    expect(data.attempts).toEqual([{ test: 0, run: 0, steps: 4 }]);
    const page = data.routes.find((r: any) => r.route === '/page');
    expect(page.elements.map((e: any) => [e.key, e.ts])).toEqual([
      ['#one', [[0, 1]]],
      ['#two', [[0, 2]]],
    ]);
  });

  describe('a step on one of several repeated elements', () => {
    /** A raw node tree under <html><body>; `add` returns the new node's index. */
    const tree = () => {
      const nodes: RawNode[] = [{ tag: 'html' }, { tag: 'body', parent: 0 }];
      const add = (tag: string, parent: number, extra: Partial<RawNode> = {}) => (nodes.push({ tag, parent, ...extra }), nodes.length - 1);
      return { nodes, add };
    };
    const at = (node: number, y: number, name = 'Delete') => ({ node, name, x: 10, y, w: 50, h: 20 });
    const shot = (url: string, hash: string, t: number, elements: RawSnapshot['elements']): RawSnapshot => ({
      url, dpr: 1, elements, screenshot: `shot-${hash}`, screenshotClip: { x: 0, y: 0, width: 800, height: 600 }, t, hash,
    });
    const run = (data: RawCoverageData) =>
      aggregate([{ title: 't', testId: 't', retry: 0, passed: true, data: resolveCoverageData(data) }], opts);
    const hint = (data: RawCoverageData, i = 0) => resolveCoverageData(data).steps![i].target?.hint;
    const raw = (nodes: RawNode[], url: string, extra: Partial<RawCoverageData>): RawCoverageData => ({
      formatVersion: 4, nodes, snapshots: [], interactions: [], ...extra,
    });

    /**
     * /users: a table (`tbody`) with a "Delete" button on each of 3 rows,
     * grouped into one element. `rowAttrs` gives each row's attributes.
     */
    const users = (rowAttrs: (i: number) => Record<string, string> = (i) => ({ id: `user-${i}` })) => {
      const t = tree();
      const tbody = t.add('tbody', t.add('table', 1, { attrs: { 'data-testid': 'users' } }));
      /** A row as the tracker records it in one inventory: its position among the rows there. */
      const row = (i: number, nth: number, of: number) => t.add('button', t.add('td', t.add('tr', tbody, { nth, of, attrs: rowAttrs(i) })));
      return { ...t, row, buttons: [1, 2, 3].map((i) => row(i, i, 3)) };
    };
    const url = 'http://app/users';

    it('names the row and outlines only that instance, in the page right before the step', () => {
      const u = users();
      const elements = u.buttons.map((b, i) => at(b, 10 + i * 30));
      // After the click, row 2 is gone and row 3 is the 2nd of 2 rows (a new node, as the tracker records it).
      const after = [at(u.row(1, 1, 2), 10), at(u.row(3, 2, 2), 40)];
      const summary = run(raw(u.nodes, url, {
        snapshots: [{ url, dpr: 1, elements, t: 1000 }],
        interactions: [{ event: 'click', url, element: { node: u.buttons[1], name: 'Delete' } }],
        steps: [
          { t: 900, event: 'load', url, state: 0 },
          { t: 1100, event: 'click', url, element: { node: u.buttons[1], name: 'Delete' }, state: 1 },
        ],
        states: [shot(url, 'all', 950, elements), shot(url, 'deleted', 1150, after)],
      }));
      const users_ = summary.routes[0];
      expect(users_.elements.map((e) => [e.label, e.group?.reason, e.instances])).toEqual([['button "Delete"', 'row', 3]]);
      const step = summary.attempts![0].steps[1];
      expect(step).toMatchObject({ key: users_.elements[0].key, instance: 'row 2 of 3 · #user-2', beforeBox: 1 });
      expect(users_.states![step.before!.index].boxes[1]).toMatchObject({ y: 40 });
      let payload: any;
      new Function('__uicovData', renderLazyFiles(summary).get('test-0.js')!)((_k: string, _i: number, p: unknown) => (payload = p));
      expect(payload.steps[1]).toMatchObject({ instance: 'row 2 of 3 · #user-2', beforeBox: 1 });
    });

    it('never picks a box after the step, where another record can have taken its place', () => {
      // No row identities: row 3 moved up into row 2's exact place and position.
      const u = users(() => ({}));
      const elements = u.buttons.map((b, i) => at(b, 10 + i * 30));
      const after = [at(u.row(1, 1, 2), 10), at(u.row(3, 2, 2), 40)];
      const step = run(raw(u.nodes, url, {
        snapshots: [{ url, dpr: 1, elements }],
        steps: [
          { t: 1, event: 'load', url, state: 0 },
          { t: 2, event: 'click', url, element: { node: u.buttons[1], name: 'Delete' }, state: 1 },
        ],
        states: [shot(url, 'all', 1, elements), shot(url, 'deleted', 3, after)],
      })).attempts![0].steps[1];
      expect(step.instance).toBe('row 2 of 3');
      expect(step.beforeBox).toBe(1);
      expect(Object.keys(step)).not.toContain('afterBox');
    });

    it('doesn’t pick a box in an outdated Before (an earlier step took no screenshot)', () => {
      const u = users();
      const add = u.add('button', 1, { attrs: { id: 'add' } });
      const elements = [at(add, 0, 'Add'), ...u.buttons.map((b, i) => at(b, 10 + i * 30))];
      const step = run(raw(u.nodes, url, {
        snapshots: [{ url, dpr: 1, elements }],
        steps: [
          { t: 1, event: 'load', url, state: 0 },
          // Adds a row at the top; screenshots were used up (`maxStepScreenshots`).
          { t: 2, event: 'click', url, element: { node: add, name: 'Add' } },
          { t: 3, event: 'click', url, element: { node: u.buttons[1], name: 'Delete' } },
        ],
        states: [shot(url, 'all', 1, elements)],
      })).attempts![0].steps[2];
      expect(step.before).toBeDefined();
      expect(step.beforeBox).toBeUndefined();
    });

    it('identity paths keep a moved record from matching', () => {
      const u = users();
      // Row 3 after row 2 is deleted: same position as row 2 before, different record.
      const moved = u.row(3, 2, 2);
      const data = resolveCoverageData(raw(u.nodes, url, {
        snapshots: [{ url, dpr: 1, elements: [at(u.buttons[1], 40), at(moved, 40)] }],
      }));
      const [before, now] = data.snapshots[0].elements.map((e) => e.instance);
      expect(before).not.toBe(now);
    });

    it('without row identities, gives the position, plus the element’s own identity when it has digits', () => {
      const u = users(() => ({}));
      u.nodes[u.buttons[1]].attrs = { 'data-testid': 'delete-user-2' };
      const data = raw(u.nodes, url, { steps: [{ t: 1, event: 'click', url, element: { node: u.buttons[1], name: 'Delete' } }] });
      expect(hint(data)).toBe('row 2 of 3 · [data-testid="delete-user-2"]');
      // The same identity on every row (no digits) doesn't point at a record.
      u.nodes[u.buttons[1]].attrs = { 'data-testid': 'delete-user' };
      expect(hint(data)).toBe('row 2 of 3');
    });

    it('names the card, not a wrapper every card has at the same place', () => {
      // ul > li.card × 3 > (div.title, div.actions > (button "Add", button "Save"))
      const t = tree();
      const ul = t.add('ul', 1);
      const buttons = [1, 2, 3].map((i) => {
        const li = t.add('li', ul, { nth: i, of: 3, attrs: { class: 'card' } });
        t.add('div', li, { nth: 1, of: 2, attrs: { class: 'title' } });
        const actions = t.add('div', li, { nth: 2, of: 2, attrs: { class: 'actions' } });
        t.add('button', actions, { nth: 2, of: 2 }); // "Save for later", next to it
        return t.add('button', actions, { nth: 1, of: 2 });
      });
      const shop = 'http://app/shop';
      const data = raw(t.nodes, shop, {
        snapshots: [{ url: shop, dpr: 1, elements: buttons.map((b, i) => at(b, i * 30, 'Add')) }],
        steps: buttons.map((node, i) => ({ t: i, event: 'click', url: shop, element: { node, name: 'Add' } })),
      });
      expect([0, 1, 2].map((i) => hint(data, i))).toEqual(['item 1 of 3', 'item 2 of 3', 'item 3 of 3']);
      const steps = run(data).attempts![0].steps;
      expect(steps.map((s) => s.instance)).toEqual(['item 1 of 3', 'item 2 of 3', 'item 3 of 3']);
    });

    it('names the element itself when it is the repeated one (a star of a rating group)', () => {
      const t = tree();
      const wrap = t.add('div', 1, { nth: 1, of: 2, attrs: { 'data-uicov-group': 'star-rating' } });
      t.add('div', 1, { nth: 2, of: 2 });
      const stars = [1, 2, 3, 4, 5].map((i) => t.add('button', wrap, { nth: i, of: 5 }));
      const shop = 'http://app/shop';
      const data = raw(t.nodes, shop, {
        snapshots: [{ url: shop, dpr: 1, elements: stars.map((b, i) => ({ node: b, name: `${i + 1} stars`, x: i * 20, y: 0, w: 20, h: 20 })) }],
        steps: [{ t: 1, event: 'click', url: shop, element: { node: stars[3], name: '4 stars' } }],
      });
      expect(run(data).attempts![0].steps[0].instance).toBe('item 4 of 5');
    });

    it('in repeated items outside a table: the item and its identity', () => {
      const t = tree();
      const ul = t.add('ul', 1);
      const buttons = [1, 2].map((i) => t.add('button', t.add('li', ul, { nth: i, of: 2, attrs: { 'data-testid': `sku-${i}` } })));
      const shop = 'http://app/shop';
      const data = raw(t.nodes, shop, {
        snapshots: [{ url: shop, dpr: 1, elements: buttons.map((b, i) => at(b, i * 30, 'Add to cart')) }],
        steps: [{ t: 1, event: 'click', url: shop, element: { node: buttons[1], name: 'Add to cart' } }],
      });
      expect(run(data).attempts![0].steps[0].instance).toBe('item 2 of 2 · [data-testid="sku-2"]');
    });

    it('says nothing for an element seen once: a field merged with its label, an explicit group of one', () => {
      const t = tree();
      const form = t.add('form', 1, { attrs: { id: 'signup' } });
      const elements: RawSnapshot['elements'] = [];
      const fields = ['email', 'password', 'name'].map((name, i) => {
        const field = t.add('div', form, { nth: i + 1, of: 3, attrs: { class: 'field' } });
        elements.push({ node: t.add('label', field, { attrs: { for: name, tabindex: '0' } }), name, x: 0, y: i * 40, w: 50, h: 20 });
        const input = t.add('input', field, { attrs: { id: name } });
        elements.push({ node: input, name, x: 60, y: i * 40, w: 100, h: 20 });
        return { field, input };
      });
      const page = 'http://app/signup';
      const data = (shown = elements) => raw(t.nodes, page, {
        snapshots: [{ url: page, dpr: 1, elements: shown }],
        steps: [{ t: 1, event: 'input', url: page, element: { node: fields[1].input, name: 'password' } }],
      });
      const summary = run(data());
      expect(summary.routes[0].elements.find((e) => e.key === '#password')?.group?.reason).toBe('label');
      expect(summary.attempts![0].steps[0].instance).toBeUndefined();
      // Each field an explicit group, with only its input counted: a group of one.
      fields.forEach((f, i) => (t.nodes[f.field].attrs = { 'data-uicov-group': `field-${i}` }));
      const inputs = elements.filter((e) => t.nodes[e.node].tag === 'input');
      const grouped = run(data(inputs));
      expect(grouped.routes[0].elements.find((e) => e.key === '[data-uicov-group="field-1"]')?.group?.reason).toBe('markup');
      expect(grouped.attempts![0].steps[0].instance).toBeUndefined();
    });

    it('names the row of a link that leads to another view', () => {
      const t = tree();
      const tbody = t.add('tbody', t.add('table', 1));
      const links = [1, 2, 3].map((i) => t.add('a', t.add('td', t.add('tr', tbody, { nth: i, of: 3 })), { attrs: { href: `/users/${i}` } }));
      const step = run(raw(t.nodes, url, {
        snapshots: [{ url, dpr: 1, elements: links.map((l, i) => at(l, i * 30, 'Open')) }],
        steps: [{ t: 1, event: 'click', url, element: { node: links[1], name: 'Open' } }],
      })).attempts![0].steps[0];
      expect(step.instance).toBe('row 2 of 3');
    });

    it('finds the row across a shadow root', () => {
      // tr#user-N > td > row-actions >> (div.menu, div > button)
      const t = tree();
      const tbody = t.add('tbody', t.add('table', 1));
      const buttons = [1, 2, 3].map((i) => {
        const host = t.add('row-actions', t.add('td', t.add('tr', tbody, { nth: i, of: 3, attrs: { id: `user-${i}` } })));
        const root = t.add('#shadow-root', host);
        t.add('div', root, { nth: 1, of: 2, attrs: { class: 'menu' } });
        return t.add('button', t.add('div', root, { nth: 2, of: 2 }));
      });
      const data = raw(t.nodes, url, { steps: [{ t: 1, event: 'click', url, element: { node: buttons[1], name: 'Delete' } }] });
      expect(hint(data)).toBe('row 2 of 3 · #user-2');
    });

    describe('row positions', () => {
      const step = (nodes: RawNode[], node: number) => raw(nodes, url, { steps: [{ t: 1, event: 'click', url, element: { node, name: 'Delete' } }] });

      it('use aria-rowindex and aria-rowcount when set (virtualized grids)', () => {
        const t = tree();
        const group = t.add('div', t.add('div', 1, { attrs: { role: 'grid', 'aria-rowcount': '100' } }), { attrs: { role: 'rowgroup' } });
        const b = t.add('button', t.add('div', group, { nth: 3, of: 20, attrs: { role: 'row', 'aria-rowindex': '42' } }));
        expect(hint(step(t.nodes, b))).toBe('row 42 of 100');
      });

      it('are left out where they restart or count other elements', () => {
        // The 1st row of a table's 2nd tbody: only its identity.
        const t = tree();
        const table = t.add('table', 1);
        t.add('tbody', table, { nth: 1, of: 2 });
        const row = t.add('tr', t.add('tbody', table, { nth: 2, of: 2 }), { nth: 1, of: 2 });
        const b = t.add('button', t.add('td', row));
        expect(hint(step(t.nodes, b))).toBeUndefined();
        t.nodes[row].attrs = { id: 'user-3' };
        expect(hint(step(t.nodes, b))).toBe('#user-3');
        // A role=row among the grid's other elements (a header, a toolbar).
        const g = tree();
        const gb = g.add('button', g.add('div', g.add('div', 1, { attrs: { role: 'grid' } }), { nth: 2, of: 4, attrs: { role: 'row' } }));
        expect(hint(step(g.nodes, gb))).toBeUndefined();
      });

      it('name the outer record of a nested table first', () => {
        const t = tree();
        const outer = t.add('tr', t.add('tbody', t.add('table', 1)), { nth: 2, of: 3, attrs: { id: 'order-7' } });
        const inner = t.add('tr', t.add('tbody', t.add('table', t.add('td', outer))));
        const b = t.add('button', t.add('td', inner));
        expect(hint(step(t.nodes, b))).toBe('row 2 of 3 · #order-7 › row 1');
      });
    });
  });
});
