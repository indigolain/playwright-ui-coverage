// Steps and states (recording option `steps`): the raw format, which call a
// step came from, and the states a view's stepper goes through.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { aggregate, defaultNormalizeUrl, type TestEntry } from '../src/aggregate';
import { pickCall, trackCalls } from '../src/calls';
import { renderLazyFiles } from '../src/html';
import { inputGate } from '../src/input-gate';
import { resolveCoverageData } from '../src/model/resolve';
import type { RawCoverageData, RawNode, RawSnapshot } from '../src/model/raw';
import { buildReport, readData, writeData } from '../src/report';
import { routeStates } from '../src/steps';
import type { InventoryElement, Snapshot } from '../src/types';

describe('pickCall', () => {
  const calls = [
    { name: 'goto', kind: 'navigation' as const, begin: 100, end: 150 },
    { name: 'fill', kind: 'action' as const, begin: 160, end: 200 },
    { name: 'click', kind: 'action' as const, begin: 201, end: undefined as number | undefined },
  ];
  it('credits an event to the action in progress when it happened, even if it arrives later', () => {
    expect(pickCall(calls, 'action', 300, 190)?.name).toBe('fill');
    expect(pickCall(calls, 'action', 300, 250)?.name).toBe('click');
    // On a boundary, the call that contains the time exactly wins over clock slack.
    expect(pickCall(calls, 'action', 300, 200)?.name).toBe('fill');
    expect(pickCall(calls, 'action', 300, 50)).toBeUndefined();
  });
  it('without a time: the action in progress, else one that just ended', () => {
    expect(pickCall(calls, 'action', 300)?.name).toBe('click');
    const ended = calls.map((c) => ({ ...c, end: c.end ?? 260 }));
    expect(pickCall(ended, 'action', 300)?.name).toBe('click');
    expect(pickCall(ended, 'action', 2000)).toBeUndefined();
  });
  it('credits a load to a navigation only when it was the last call', () => {
    expect(pickCall(calls.slice(0, 1), 'navigation', 160)?.name).toBe('goto');
    expect(pickCall(calls, 'navigation', 300)).toBeUndefined(); // the click after the goto loaded it
  });
});

describe('trackCalls', () => {
  /** Playwright's client instrumentation: a listener list called for every `on*` hook. */
  const instrumentation = () => {
    const listeners = new Set<any>();
    return {
      listeners,
      addListener: (l: any) => listeners.add(l),
      removeListener: (l: any) => listeners.delete(l),
      begin: (...args: unknown[]) => listeners.forEach((l) => l.onApiCallBegin?.(...args)),
      end: (zone: unknown) => listeners.forEach((l) => l.onApiCallEnd?.(zone)),
    };
  };
  const frames = [{ file: '/repo/tests/users.spec.ts', line: 18, column: 52 }];
  const opts = { formatLocator: (s: string) => `locator(${JSON.stringify(s)})`, baseDir: '/repo/tests' };

  it('reads both shapes of onApiCallBegin, with the spec location relative to testDir', () => {
    const inst = instrumentation();
    const tracker = trackCalls({ _instrumentation: inst }, opts)!;
    // Up to 1.5x: params on the zone.
    const old = { apiName: 'locator.click', frames, params: { selector: 'internal:role=button' } };
    inst.begin(old);
    expect(tracker.current('action', Date.now())).toEqual({
      api: 'locator.click',
      locator: 'locator("internal:role=button")',
      file: 'users.spec.ts',
      line: 18,
      column: 52,
    });
    inst.end(old);
    // Since: the channel as second argument. Typed text is never recorded; a key is.
    const zone = { apiName: 'locator.press', frames };
    inst.begin(zone, { type: 'Frame', method: 'press', params: { selector: '#q', key: 'Enter' } });
    expect(tracker.current('action', Date.now())).toMatchObject({ api: 'locator.press', arg: 'Enter' });
    const fill = { apiName: 'locator.fill', frames };
    inst.begin(fill, { type: 'Frame', method: 'fill', params: { selector: '#q', value: 'secret' } });
    expect(JSON.stringify(tracker.current('action', Date.now()))).not.toContain('secret');
    tracker.dispose();
    expect(inst.listeners.size).toBe(0);
  });

  it('ignores calls that are not actions, and unexpected shapes', () => {
    const inst = instrumentation();
    const tracker = trackCalls({ _instrumentation: inst }, opts)!;
    inst.begin({ apiName: 'expect.toBeVisible', frames });
    inst.begin(undefined);
    inst.begin({ apiName: 42 });
    inst.begin({ apiName: 'page.click', frames: 'nope' });
    expect(tracker.current('action', Date.now())).toEqual({ api: 'page.click' });
  });

  it('is undefined without the private instrumentation', () => {
    expect(trackCalls({}, opts)).toBeUndefined();
    expect(trackCalls({ _instrumentation: { addListener: 1 } }, opts)).toBeUndefined();
  });
});

describe('input gate hold', () => {
  it('keeps input back until released, and other pages are not affected', async () => {
    const log: string[] = [];
    const connection = { sendMessageToServer: async (o: { name: string }, m: string) => void log.push(`${o.name}.${m}`) };
    const page = { _type: 'Page', name: 'page', _connection: connection };
    const other = { _type: 'Page', name: 'other' };
    const gate = inputGate(page)!;
    const release = gate.hold(page);
    const send = (o: object, m: string) => (connection as any).sendMessageToServer(o, m);
    const held = send(page, 'mouseClick');
    void send(other, 'mouseClick');
    void send(page, 'screenshot'); // not input
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual(['other.mouseClick', 'page.screenshot']);
    release();
    await held;
    expect(log).toEqual(['other.mouseClick', 'page.screenshot', 'page.mouseClick']);
  });

  it('a held input waits for a capture that started meanwhile', async () => {
    const log: string[] = [];
    const connection = { sendMessageToServer: async (_o: unknown, m: string) => void log.push(m) };
    const page = { _type: 'Page', _connection: connection };
    const gate = inputGate(page)!;
    const release = gate.hold(page);
    const held = (connection as any).sendMessageToServer(page, 'keyboardPress');
    let finish!: () => void;
    const capture = gate.exclusive(page, () => {
      release(); // a step's capture releases its hold once it runs
      return new Promise<void>((r) => (finish = r));
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual([]);
    finish();
    await capture;
    await held;
    expect(log).toEqual(['keyboardPress']);
  });
});

/** A raw recording with one button, a load step and a click step, and their states. */
function rawRecording(formatVersion = 4): RawCoverageData {
  const nodes: RawNode[] = [{ tag: 'html' }, { tag: 'body', parent: 0 }, { tag: 'button', parent: 1, attrs: { id: 'save' } }, { tag: 'button', parent: 1, attrs: { id: 'skip', 'data-uicov-ignore': '' } }];
  const element = { node: 2, name: 'Save', x: 10, y: 10, w: 50, h: 20 };
  const state = (hash: string, t: number): RawSnapshot => ({
    url: 'http://app/form',
    dpr: 1,
    elements: [element],
    screenshot: `ui-coverage-screenshot-${hash}`,
    screenshotClip: { x: 0, y: 0, width: 800, height: 600 },
    t,
    hash,
  });
  return {
    formatVersion,
    nodes,
    snapshots: [{ url: 'http://app/form', dpr: 1, elements: [element], screenshot: 'ui-coverage-screenshot-0', t: 1000, hash: 'full' }],
    interactions: [{ event: 'click', url: 'http://app/form', element: { node: 2, name: 'Save' } }],
    steps: [
      { t: 900, event: 'load', url: 'http://app/form', state: 0, call: { api: 'page.goto', arg: '/form', file: 'form.spec.ts', line: 3 } },
      { t: 1100, event: 'click', url: 'http://app/form', element: { node: 2, name: 'Save' }, state: 1, call: { api: 'locator.click', locator: "getByRole('button', { name: 'Save' })" } },
      { t: 1200, event: 'click', url: 'http://app/form', element: { node: 3, name: 'Skip' } },
    ],
    states: [state('a', 950), state('b', 1150)],
  };
}

describe('resolving steps', () => {
  it('resolves step targets and states with the report-time rules', () => {
    const data = resolveCoverageData(rawRecording());
    expect(data.steps!.map((s) => [s.event, s.target?.key, s.target?.label ?? s.name, s.state])).toEqual([
      ['load', undefined, undefined, 0],
      ['click', '#save', 'button "Save"', 1],
      // Excluded by the rules: no target, just the name.
      ['click', undefined, 'Skip', undefined],
    ]);
    expect(data.steps![1].call).toEqual({ api: 'locator.click', locator: "getByRole('button', { name: 'Save' })" });
    expect(data.states!.map((s) => [s.hash, s.t, s.elements.map((e) => e.key)])).toEqual([
      ['a', 950, ['#save']],
      ['b', 1150, ['#save']],
    ]);
    expect(data.snapshots[0]).toMatchObject({ t: 1000, hash: 'full' });
  });

  it('still reads version 3 recordings, which have no steps', () => {
    const { steps: _, states: __, ...v3 } = rawRecording(3);
    const data = resolveCoverageData({ ...v3, snapshots: v3.snapshots.map(({ t, hash, ...s }) => s) });
    expect(data.steps).toBeUndefined();
    expect(data.states).toBeUndefined();
    expect(data.interactions).toHaveLength(1);
  });

  it('rejects versions it does not know', () => {
    expect(() => resolveCoverageData(rawRecording(5))).toThrow(/unsupported recording formatVersion 5/);
  });
});

const el = (key: string, x: number, extra: Partial<InventoryElement> = {}): InventoryElement => ({
  key, label: key, tag: 'button', x, y: 0, w: 10, h: 10, ...extra,
});
const shot = (name: string, keys: string[], extra: Partial<Snapshot> = {}): Snapshot => ({
  url: 'http://x/page',
  dpr: 1,
  screenshot: name,
  elements: keys.map((k, i) => el(k, i * 20)),
  ...extra,
});

describe('states of a view', () => {
  it('are every screenshot, in the order reached, one per hash, with their own coverage', () => {
    const entry = (title: string, retry: number, passed: boolean, data: TestEntry['data']): TestEntry => ({
      title, testId: title, retry, passed, interactions: passed ? 'tested' : 'ignore', data,
    });
    const tests: TestEntry[] = [
      entry('a', 0, true, {
        snapshots: [shot('full-a', ['#one', '#two'], { t: 30, hash: 'h-full' })],
        interactions: [{ key: '#one', label: '#one', event: 'click', url: 'http://x/page' }],
        states: [
          shot('s1', ['#one'], { t: 10, hash: 'h1', screenshotClip: { x: 0, y: 0, width: 100, height: 100 } }),
          shot('s2', ['#one', '#two'], { t: 20, hash: 'h2', screenshotClip: { x: 0, y: 0, width: 100, height: 100 } }),
        ],
      }),
      // A failed first attempt of another test reached state h1 too.
      entry('b', 0, false, {
        snapshots: [],
        interactions: [{ key: '#two', label: '#two', event: 'click', url: 'http://x/page' }],
        states: [shot('s1-again', ['#one'], { t: 40, hash: 'h1', screenshotClip: { x: 0, y: 0, width: 100, height: 100 } })],
      }),
      entry('b', 1, true, { snapshots: [shot('no-time', ['#two'])], interactions: [] }),
    ];
    const summary = aggregate(tests, { normalizeUrl: defaultNormalizeUrl, maxScreenshotsPerRoute: 1 });
    expect(summary.attempts!.map((a) => [a.title, a.retry, a.passed, a.use])).toEqual([
      ['a', 0, true, 'tested'],
      ['b', 0, false, 'ignore'],
      ['b', 1, true, 'tested'],
    ]);
    const r = summary.routes[0];
    // Coverage doesn't change: only test a's click counts.
    expect([r.tested, r.total]).toEqual([1, 2]);
    expect(r.screenshots).toHaveLength(1);
    expect(r.states!.map((s) => [s.source, s.tested, s.total, s.attempts, s.viewport ?? false])).toEqual([
      ['s1', 1, 1, [0, 1], true],
      ['s2', 1, 2, [0], true],
      ['full-a', 1, 2, [0], false],
      ['no-time', 0, 1, [2], false], // no time (older recordings): after the others
    ]);
  });

  it('use the report’s grouped keys, without taking part in the grouping', () => {
    const member = (key: string, x: number) => el(key, x, { grouping: { explicit: { key: 'group:rows', name: 'rows', reason: 'markup' } } });
    const summary = aggregate(
      [{
        title: 't', testId: 't', retry: 0, passed: true,
        data: {
          snapshots: [{ url: 'http://x/page', dpr: 1, elements: [member('#r1', 0), member('#r2', 20)] }],
          interactions: [],
          // A state shows a third row; it's drawn as the group, and doesn't add a member.
          states: [{ ...shot('s', []), elements: [member('#r3', 40)], hash: 'h' }],
        },
      }],
      { normalizeUrl: defaultNormalizeUrl, maxScreenshotsPerRoute: 3 },
    );
    const r = summary.routes[0];
    expect(r.elements.map((e) => [e.key, e.group?.members])).toEqual([['group:rows', 2]]);
    expect(r.states![0].boxes.map((b) => b.key)).toEqual(['group:rows']);
  });

  it('routeStates keeps candidates without a screenshot out', () => {
    const { states } = routeStates([{ snap: { ...shot('x', ['#a']), screenshot: undefined }, attempt: 0, seq: 0 }], () => [], () => true);
    expect(states).toEqual([]);
  });

  it('renders each view’s states into a file the page loads on demand', () => {
    const summary = aggregate(
      [{ title: 't', testId: 't', retry: 0, passed: true, data: { snapshots: [shot('a.png', ['#one'], { hash: 'h' })], interactions: [] } }],
      { normalizeUrl: defaultNormalizeUrl, maxScreenshotsPerRoute: 3 },
    );
    const files = renderLazyFiles(summary);
    expect([...files.keys()]).toEqual(['view-0.js']);
    const calls: unknown[][] = [];
    new Function('__uicovData', files.get('view-0.js')!)((...args: unknown[]) => calls.push(args));
    expect(calls).toEqual([
      ['view', 0, { states: [{ source: 'a.png', dpr: 1, tested: 0, total: 1, attempts: [0], boxes: [[0, 0, 0, 10, 10]] }] }],
    ]);
  });
});

describe('the report folder', () => {
  it('keeps step screenshots in data/, rebuilds from it, and links states there', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uicov-steps-'));
    const src = path.join(dir, 'src');
    fs.mkdirSync(src);
    const raw = rawRecording();
    for (const s of [...raw.snapshots, ...raw.states!]) {
      const file = path.join(src, `${s.hash}.png`);
      fs.writeFileSync(file, `png ${s.hash}`);
      s.screenshot = file;
    }
    const out = path.join(dir, 'report');
    writeData(path.join(out, 'data'), { attempts: [{ testId: 't', retry: 0, passed: true, title: 'form', data: raw }] });
    const input = readData(path.join(out, 'data'));
    const states = (input.attempts[0].data as RawCoverageData).states!;
    expect(states.every((s) => fs.existsSync(s.screenshot!))).toBe(true);
    const log = console.log;
    console.log = () => {};
    try {
      const { summary } = buildReport(input, {}, out);
      const r = summary.routes[0];
      // The chosen screenshot is copied into screens/; the other states point into data/.
      expect(r.screenshots.map((s) => s.source)).toEqual(['screens/0.png']);
      expect(r.states!.map((s) => s.source)).toEqual(['data/screenshots/1.png', 'screens/0.png', 'data/screenshots/2.png']);
      expect(fs.existsSync(path.join(out, 'steps', 'view-0.js'))).toBe(true);
      // coverage.json doesn't list states.
      expect(JSON.stringify(JSON.parse(fs.readFileSync(path.join(out, 'coverage.json'), 'utf8')))).not.toContain('states');
    } finally {
      console.log = log;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
