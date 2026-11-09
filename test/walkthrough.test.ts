// The per-test walkthrough: steps of each attempt with the page before and
// after them, links from "Tested by", and the files the page loads on demand.
import { describe, expect, it } from 'vitest';
import { aggregate, defaultNormalizeUrl, type TestEntry } from '../src/aggregate';
import { renderHtml, renderLazyFiles } from '../src/html';
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
});
