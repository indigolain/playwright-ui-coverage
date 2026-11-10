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
    /**
     * /users: a table with a "Delete" button on each of 3 rows (`tr#user-N`),
     * grouped into one element. The test clicks the Delete of row 2.
     */
    const raw = (rowAttrs: (i: number) => Record<string, string> = (i) => ({ id: `user-${i}` })): RawCoverageData => {
      const nodes: RawNode[] = [
        { tag: 'html' },
        { tag: 'body', parent: 0 },
        { tag: 'table', parent: 1, attrs: { 'data-testid': 'users' } },
        { tag: 'tbody', parent: 2 },
      ];
      const buttons: number[] = [];
      for (let i = 1; i <= 3; i++) {
        nodes.push({ tag: 'tr', parent: 3, nth: i, of: 3, attrs: rowAttrs(i) });
        nodes.push({ tag: 'td', parent: nodes.length - 1 });
        nodes.push({ tag: 'button', parent: nodes.length - 1 });
        buttons.push(nodes.length - 1);
      }
      const elements = buttons.map((node, i) => ({ node, name: 'Delete', x: 10, y: 10 + i * 30, w: 50, h: 20 }));
      const state = (hash: string, t: number, rows = elements): RawSnapshot => ({
        url: 'http://app/users',
        dpr: 1,
        elements: rows,
        screenshot: `shot-${hash}`,
        screenshotClip: { x: 0, y: 0, width: 800, height: 600 },
        t,
        hash,
      });
      const row2 = { node: buttons[1], name: 'Delete' };
      return {
        formatVersion: 4,
        nodes,
        snapshots: [{ url: 'http://app/users', dpr: 1, elements, t: 1000 }],
        interactions: [{ event: 'click', url: 'http://app/users', element: row2 }],
        steps: [
          { t: 900, event: 'load', url: 'http://app/users', state: 0 },
          { t: 1100, event: 'click', url: 'http://app/users', element: row2, state: 1 },
        ],
        // After the click, row 2 is gone: row 3 moved up into its place.
        states: [state('all', 950), state('deleted', 1150, [elements[0], { ...elements[2], y: 40 }])],
      };
    };
    const run = (data: RawCoverageData) =>
      aggregate([{ title: 't', testId: 't', retry: 0, passed: true, data: resolveCoverageData(data) }], opts);

    it('names the row it was in and outlines only that instance', () => {
      const summary = run(raw());
      const users = summary.routes[0];
      expect(users.elements.map((e) => [e.label, e.group?.reason, e.instances])).toEqual([['button "Delete"', 'row', 3]]);
      const step = summary.attempts![0].steps[1];
      expect(step).toMatchObject({ key: users.elements[0].key, instance: 'row 2 of 3 · #user-2' });
      // Before: the second of the three boxes. After: row 2 isn't there any more.
      expect(step.beforeBox).toBe(1);
      expect(users.states![step.before!.index].boxes[1]).toMatchObject({ y: 40 });
      expect(step.afterBox).toBeUndefined();
      // The walkthrough file carries both.
      let payload: any;
      new Function('__uicovData', renderLazyFiles(summary).get('test-0.js')!)((_k: string, _i: number, p: unknown) => (payload = p));
      expect(payload.steps[1]).toMatchObject({ instance: 'row 2 of 3 · #user-2', beforeBox: 1 });
      expect(payload.steps[1].afterBox).toBeUndefined();
    });

    it('without row identities, gives the position, plus the element’s own identity', () => {
      const data = raw(() => ({}));
      const button = data.interactions[0].element.node;
      data.nodes[button].attrs = { 'data-testid': 'delete-user-2' };
      const step = run(data).attempts![0].steps[1];
      expect(step.instance).toBe('row 2 of 3 · [data-testid="delete-user-2"]');
      // The same identity on every row (no digits) doesn't point at a record.
      data.nodes[button].attrs = { 'data-action': 'delete-user' };
      expect(run(data).attempts![0].steps[1].instance).toBe('row 2 of 3');
    });

    it('in repeated items outside a table: the item', () => {
      const nodes: RawNode[] = [{ tag: 'html' }, { tag: 'body', parent: 0 }, { tag: 'ul', parent: 1 }];
      for (let i = 1; i <= 2; i++) {
        nodes.push({ tag: 'li', parent: 2, nth: i, of: 2, attrs: { 'data-sku': `sku-${i}` } });
        nodes.push({ tag: 'button', parent: nodes.length - 1 });
      }
      const elements = [4, 6].map((node, i) => ({ node, name: 'Add to cart', x: 0, y: i * 30, w: 50, h: 20 }));
      const data = resolveCoverageData({
        formatVersion: 4,
        nodes,
        snapshots: [{ url: 'http://app/shop', dpr: 1, elements }],
        interactions: [],
        steps: [{ t: 1, event: 'click', url: 'http://app/shop', element: { node: 6, name: 'Add to cart' } }],
      });
      // `data-sku` isn't an identity attribute: just the position.
      expect(data.steps![0].target?.hint).toBe('item 2 of 2');
      const step = aggregate([{ title: 't', testId: 't', retry: 0, passed: true, data }], opts).attempts![0].steps[0];
      expect(step.instance).toBe('item 2 of 2');
    });

    it('says nothing for an element that stands for one', () => {
      const summary = aggregate([{ title: 't', testId: 't', retry: 0, passed: true, data: recording() }], opts);
      expect(summary.attempts![0].steps.some((s) => 'instance' in s || 'beforeBox' in s)).toBe(false);
    });
  });
});

