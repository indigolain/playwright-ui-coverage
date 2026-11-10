import type { CoverageSummary, ElementCoverage, RouteCoverage, ScreenshotBox } from './aggregate';
import type { StateRef } from './steps';
import { mostRepeated } from './insights';
import { testSkeleton } from './locators';

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The <a> elements of a route's link units, once each: `links[].refs` and boxes index into them. */
const linkElsOf = (r: RouteCoverage) => [...new Set((r.links ?? []).flatMap((l) => l.referrers))];

/** Boxes become `[index, x, y, w, h, pos?]`: an index into elements, then (offset by elements.length) into linkEls. */
function boxCompactor(r: RouteCoverage) {
  const index = new Map([...r.elements, ...linkElsOf(r)].map((e, i) => [e.key, i]));
  return (b: ScreenshotBox) => {
    const i = index.get(b.key);
    if (i === undefined) return b;
    const out: (number | string)[] = [i, round1(b.x), round1(b.y), round1(b.w), round1(b.h)];
    if (b.pos) out.push(b.pos);
    return out;
  };
}

/**
 * Test attempts as the page needs them: `test` indexes `tests` (when the
 * attempt's test is listed there), `run` is the retry.
 */
function compactAttempts(summary: CoverageSummary, testIndex: Map<string, number>) {
  return (summary.attempts ?? []).map((a) => {
    const test = a.testId !== undefined ? testIndex.get(a.testId) : undefined;
    return {
      ...(test !== undefined ? { test } : { title: a.title }),
      run: a.retry,
      ...(a.passed ? {} : { failed: 1 }),
      // Its interactions don't count: a retry other than the one that passed.
      ...(a.use === 'ignore' ? { ignored: 1 } : {}),
      ...(a.trace ? { trace: a.trace } : {}),
      ...(a.project ? { project: a.project } : {}),
      steps: a.steps.length,
    };
  });
}

/**
 * The files the page loads on demand, by name in the `steps/` folder: each
 * view's states (`view-<i>.js`) and each attempt's walkthrough
 * (`test-<i>.js`), so a large report stays quick to open. Each calls
 * `__uicovData(kind, index, payload)`.
 */
export function renderLazyFiles(summary: CoverageSummary): Map<string, string> {
  const files = new Map<string, string>();
  summary.routes.forEach((r, i) => {
    if (!r.states?.length) return;
    const box = boxCompactor(r);
    const payload = {
      states: r.states.map((st) => ({
        source: st.source,
        dpr: st.dpr,
        ...(st.viewport ? { viewport: 1 } : {}),
        ...(st.t !== undefined ? { t: st.t } : {}),
        tested: st.tested,
        total: st.total,
        attempts: st.attempts,
        boxes: st.boxes.map(box),
      })),
    };
    files.set(`view-${i}.js`, lazyScript('view', i, payload));
  });
  // Walkthroughs: steps refer to states as "<route index>.<state index>"; the
  // states a test shows are included (boxes index into that route's elements).
  const routeIndex = new Map(summary.routes.map((r, i) => [r.route, i]));
  const boxers = new Map<number, ReturnType<typeof boxCompactor>>();
  (summary.attempts ?? []).forEach((a, i) => {
    if (!a.steps.length) return;
    const states: Record<string, unknown> = {};
    const ref = (s?: StateRef) => {
      const ri = s && routeIndex.get(s.route);
      const st = ri !== undefined ? summary.routes[ri].states?.[s!.index] : undefined;
      if (ri === undefined || !st) return undefined;
      const id = `${ri}.${s!.index}`;
      if (!states[id]) {
        if (!boxers.has(ri)) boxers.set(ri, boxCompactor(summary.routes[ri]));
        const box = boxers.get(ri)!;
        states[id] = { source: st.source, dpr: st.dpr, ...(st.viewport ? { viewport: 1 } : {}), boxes: st.boxes.map(box) };
      }
      return id;
    };
    const steps = a.steps.map((st) => {
      const route = st.route !== undefined ? routeIndex.get(st.route) : undefined;
      const before = ref(st.before);
      const after = ref(st.after);
      return {
        t: st.t,
        event: st.event,
        url: st.url,
        ...(route !== undefined ? { route } : {}),
        ...(st.key !== undefined ? { key: st.key } : {}),
        ...(st.label !== undefined ? { label: st.label } : {}),
        ...(st.instance !== undefined ? { instance: st.instance } : {}),
        ...(st.call ? { call: st.call } : {}),
        ...(before ? { before } : {}),
        ...(after ? { after } : {}),
        ...(before && st.beforeBox !== undefined ? { beforeBox: st.beforeBox } : {}),
        ...(after && st.afterBox !== undefined ? { afterBox: st.afterBox } : {}),
      };
    });
    files.set(`test-${i}.js`, lazyScript('test', i, { steps, states }));
  });
  return files;
}

const lazyScript = (kind: string, i: number, payload: unknown) =>
  `__uicovData(${JSON.stringify(kind)},${i},${JSON.stringify(payload).replace(/</g, '\\u003c')});\n`;

/**
 * Shrinks the embedded data: screenshot boxes become `[elementIndex, x, y, w, h]`
 * (plus `'fixed'`/`'sticky'` for fixed and sticky elements)
 * (instead of repeating each element key per box) with coordinates rounded to
 * 0.1 px. coverage.json keeps the full format.
 */
function compact(summary: CoverageSummary) {
  const tests = summary.tests ?? [];
  const testIndex = new Map(tests.map((t, i) => [t.id, i]));
  const testIdList = tests.map((t) => t.id);
  const { attempts: _, ...rest } = summary;
  /** Test id → index of its counted attempt (the one "Tested by" links to). */
  const counted = new Map<string, number>();
  (summary.attempts ?? []).forEach((a, i) => {
    if (a.use === 'tested' && a.testId !== undefined) counted.set(a.testId, i);
  });
  return {
    ...rest,
    tests,
    attempts: compactAttempts(summary, testIndex),
    mostRepeated: summary.mostRepeated ?? mostRepeated(summary),
    routes: summary.routes.map(({ states, ...r }) => {
      const linkEls = linkElsOf(r);
      const linkIndex = new Map(linkEls.map((e, i) => [e, i]));
      const untestedLinkEls = new Set((r.links ?? []).filter((l) => !l.tested).flatMap((l) => l.referrers));
      const box = boxCompactor(r);
      // The page needs neither the raw recorded data nor locators for tested elements.
      // Hints become their messages.
      const slim = ({ role, name, nameFrom, attrs, suggestedLocator, a11yHints, ...e }: ElementCoverage, keepLocator: boolean) => ({
        ...compactTestIds(e, testIndex, counted, testIdList),
        ...(keepLocator && suggestedLocator ? { suggestedLocator } : {}),
        ...(a11yHints?.length ? { a11yHints: a11yHints.map((h) => h.message) } : {}),
      });
      return {
        ...r,
        elements: r.elements.map((e) => slim(e, !e.tested)),
        // A link's locator matters while its destination is untested.
        linkEls: linkEls.map((e) => slim(e, untestedLinkEls.has(e))),
        links: (r.links ?? []).map(({ referrers, ...l }) => ({ ...l, refs: referrers.map((e) => linkIndex.get(e)!) })),
        screenshots: r.screenshots.map(({ testId: _, ...s }) => ({ ...s, boxes: s.boxes.map(box) })),
        // The states themselves are in steps/view-<i>.js.
        ...(states?.length ? { stateCount: states.length } : {}),
      };
    }),
    untestedViews: summary.untestedViews ?? [],
  };
}

/**
 * Test ids become `ti` / `tf`: indexes into `tests` (which is sorted by title),
 * so "Tested by" lists them in title order. `ts` (when any test has steps):
 * for each `ti` entry, `[attempt, step]` of the first step that acted on the
 * element, or 0.
 */
function compactTestIds(e: ElementCoverage, testIndex: Map<string, number>, counted: Map<string, number>, tests: string[]) {
  const { testIds, failingTestIds, firstStep, ...rest } = e;
  if (!testIds) return rest;
  const idx = (ids: string[] = []) =>
    ids.map((id) => testIndex.get(id)).filter((i): i is number => i !== undefined).sort((a, b) => a - b);
  const ti = idx(testIds);
  const ts = firstStep
    ? ti.map((i) => {
        const id = tests[i];
        const step = firstStep[id];
        const attempt = counted.get(id);
        return step !== undefined && attempt !== undefined ? [attempt, step] : 0;
      })
    : undefined;
  return { ...rest, ti, tf: idx(failingTestIds), ...(ts ? { ts } : {}) };
}

/**
 * Renders a self-contained HTML report (screenshots are referenced from ./screens).
 * Vanilla JS, no external requests, works from file://.
 */
export function renderHtml(summary: CoverageSummary): string {
  const data = JSON.stringify(compact(summary)).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>UI Coverage</title>
<style>
:root {
  --bg: #f7f7f8; --panel: #ffffff; --text: #18181b; --muted: #6b7280; --border: #e4e4e7;
  --ok: #16a34a; --ok-bg: rgba(22,163,74,.18); --bad: #dc2626; --bad-bg: rgba(220,38,38,.18);
  --accent: #2563eb; --hl: #f59e0b;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f0f12; --panel: #18181c; --text: #ececf1; --muted: #9ca3af; --border: #2a2a31;
    --ok: #22c55e; --ok-bg: rgba(34,197,94,.22); --bad: #f87171; --bad-bg: rgba(248,113,113,.22);
    --accent: #60a5fa;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, -apple-system, Segoe UI, sans-serif; }
header { display: flex; align-items: center; gap: 16px; padding: 14px 20px; border-bottom: 1px solid var(--border); background: var(--panel); position: sticky; top: 0; z-index: 5; flex-wrap: wrap; }
header h1 { font-size: 16px; margin: 0; }
.big { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
.muted { color: var(--muted); }
.layout { display: grid; grid-template-columns: 280px 1fr; min-height: calc(100vh - var(--hh, 58px)); background: linear-gradient(90deg, var(--panel) 279px, var(--border) 279px 280px, transparent 280px); }
nav { border-right: 1px solid var(--border); background: var(--panel); position: sticky; top: var(--hh, 58px); align-self: start; height: calc(100vh - var(--hh, 58px)); overflow-y: auto; overscroll-behavior: contain; }
@media (max-width: 760px) {
  header { position: static; }
  .layout { grid-template-columns: 1fr; background: none; }
  nav { position: static; height: auto; max-height: 45vh; border-right: 0; border-bottom: 1px solid var(--border); }
}
.navtools { position: sticky; top: 0; z-index: 1; background: var(--panel); padding: 8px 8px 6px; border-bottom: 1px solid var(--border); display: grid; gap: 6px; }
.navtools input, .navtools select { width: 100%; font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; }
.navtools input:focus, .navtools select:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.navtools .row { align-items: center; font-size: 12px; }
.navtools label { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.navtools select { width: auto; flex: 1; padding: 3px 6px; }
#navList { padding: 6px 8px 8px; }
#navList button { all: unset; display: block; width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 6px; cursor: pointer; content-visibility: auto; contain-intrinsic-size: auto 62px; }
#navList button[hidden] { display: none; }
#navList button:hover { background: var(--bg); }
#navList button:focus-visible { outline: 2px solid var(--accent); }
#navList button[aria-current=true] { background: var(--bg); outline: 1px solid var(--border); }
.sub { font-size: 12px; margin-top: 3px; }
.route { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; word-break: break-all; }
.bar { height: 4px; background: var(--bad-bg); border-radius: 2px; margin-top: 6px; overflow: hidden; }
.bar > i { display: block; height: 100%; background: var(--ok); }
.row { display: flex; justify-content: space-between; gap: 8px; }
main { padding: 20px; min-width: 0; scroll-margin-top: var(--hh, 58px); }
@media (max-width: 760px) { main { scroll-margin-top: 0; } }
@media (max-width: 760px) { main { padding: 16px; } }
.toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
.shots { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 720px), 1fr)); margin-bottom: 24px; }
figure { margin: 0; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
figcaption { padding: 6px 10px; font-size: 12px; color: var(--muted); border-top: 1px solid var(--border); }
.shot { position: relative; overflow: hidden; }
.shot:not(.loaded) { min-height: 240px; background: var(--bg); }
.shot img { display: block; width: 100%; height: auto; }
.shot.missing { min-height: 0; padding: 16px; color: var(--muted); }
.shot.missing img { display: none; }
.shot.missing::after { content: 'Screenshot not found'; }
.box { position: absolute; border: 2px solid var(--bad); background: var(--bad-bg); border-radius: 3px; cursor: pointer; }
.box.ok { border-color: var(--ok); background: var(--ok-bg); }
.box.pinned { border-style: dashed; }
.box.hl { outline: 3px solid var(--hl); outline-offset: 1px; z-index: 2; }
.only-untested .box.ok, .only-untested tr.ok { display: none; }
table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { font-size: 12px; color: var(--muted); font-weight: 600; }
tr.hl td { background: var(--bg); }
tr.picked td { background: rgba(245,158,11,.12); }
.pill { display: inline-block; white-space: nowrap; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.pill.ok { color: var(--ok); background: var(--ok-bg); }
.pill.bad { color: var(--bad); background: var(--bad-bg); }
.pill.warn { color: var(--hl); background: rgba(245,158,11,.18); }
.box.warn { border-color: var(--hl); background: rgba(245,158,11,.18); }
.warn-text { color: var(--hl); }
.table-wrap { overflow-x: auto; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
#navEmpty { padding: 8px 10px; }
th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
th button { all: unset; cursor: pointer; border-radius: 4px; }
th button:hover { color: var(--text); }
th button:focus-visible { outline: 2px solid var(--accent); }
th[aria-sort=descending] button { color: var(--text); }
th[aria-sort=descending] button::after { content: ' \\2193'; }
.tests a { color: inherit; }
.tests a:hover { color: var(--accent); }
.tests .trace { font-size: 12px; margin-left: 6px; color: var(--accent); }
#insightsNav { all: unset; display: block; box-sizing: border-box; width: calc(100% - 16px); margin: 6px 8px 0; padding: 8px 10px; border-radius: 6px; cursor: pointer; }
#insightsNav:hover { background: var(--bg); }
#insightsNav:focus-visible { outline: 2px solid var(--accent); }
#insightsNav[aria-current=true] { background: var(--bg); outline: 1px solid var(--border); }
.hint { background: var(--panel); border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 6px; padding: 10px 12px; margin: 0 0 16px; max-width: 80ch; }
.hint a, .goto { color: var(--accent); }
.snip { display: flex; gap: 6px; align-items: flex-start; margin-top: 6px; }
.snip code { flex: 1; min-width: 0; overflow-wrap: anywhere; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 2px 6px; }
.btn { font: inherit; font-size: 12px; line-height: 1.4; color: var(--text); background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 2px 8px; cursor: pointer; white-space: nowrap; }
.btn:hover { background: var(--bg); }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.btn.done { color: var(--ok); border-color: var(--ok); }
.a11y { margin-top: 4px; font-size: 12px; color: var(--accent); }
.a11y::before { content: 'ⓘ '; }
.a11y-count { color: var(--accent); }
#copyDlg { width: min(720px, calc(100vw - 32px)); background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
#copyDlg::backdrop { background: rgba(0,0,0,.4); }
#copyDlg textarea { width: 100%; max-height: 60vh; resize: vertical;font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 8px; }
#copyDlg .row { align-items: center; margin-bottom: 8px; }
@media (max-width: 760px) {
  /* Stack each row so the element and its locator get the full width. */
  table, tbody, tr, td { display: block; }
  thead tr { display: flex; justify-content: flex-end; gap: 16px; }
  thead th { border: 0; padding: 0; }
  thead th:not([data-sort]) { display: none; }
  tr { padding: 8px 10px; border-bottom: 1px solid var(--border); }
  td { border: 0; padding: 2px 0; }
  td.num { display: inline-block; margin-right: 16px; text-align: left; }
  td.num:nth-child(3)::before { content: 'Interactions: '; }
  td.num:nth-child(4)::before { content: 'Tests: '; }
  table.els td:last-child::before { content: 'Tested by: '; }
}
tr.flash td { animation: flash 1.2s ease-out; }
h2.section { font-size: 15px; margin: 24px 0 8px; display: flex; gap: 10px; align-items: baseline; }
.ref + .ref { margin-top: 6px; }
.ref.hl { background: var(--bg); outline: 1px solid var(--border); border-radius: 4px; }
.urls { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; word-break: break-all; }
.navhead { margin: 10px 8px 0; padding: 8px 10px 0; border-top: 1px solid var(--border); font-size: 12px; font-weight: 600; color: var(--muted); }
#untestedList button { all: unset; display: block; width: 100%; box-sizing: border-box; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
#untestedList button:hover { background: var(--bg); }
#untestedList button:focus-visible { outline: 2px solid var(--accent); }
#untestedList button[aria-current=true] { background: var(--bg); outline: 1px solid var(--border); }
#untestedList { padding: 4px 8px 8px; }
@keyframes flash { from { background: rgba(245,158,11,.3); } to { background: transparent; } }
.views { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 0 0 10px; }
.seg { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.seg button { font: inherit; font-size: 12px; color: var(--text); background: var(--panel); border: 0; padding: 3px 10px; cursor: pointer; }
.seg button + button { border-left: 1px solid var(--border); }
.seg button:hover { background: var(--bg); }
.seg button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.seg button[aria-pressed=true] { background: var(--bg); font-weight: 600; }
.stepper { margin-bottom: 24px; max-width: 1100px; }
.stepbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
.stepbar .pos { font-variant-numeric: tabular-nums; }
.btn:disabled { opacity: .4; cursor: default; }
.btn:disabled:hover { background: var(--panel); }
.kbd { font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 4px; padding: 0 4px; }
.reached a { color: inherit; }
.reached a:hover { color: var(--accent); }
.reached .trace { margin-left: 6px; color: var(--accent); }
.tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--border); margin: -2px 0 2px; }
.tabs button { all: unset; cursor: pointer; padding: 4px 10px 6px; font-size: 13px; color: var(--muted); border-bottom: 2px solid transparent; margin-bottom: -1px; }
.tabs button:hover { color: var(--text); }
.tabs button:focus-visible { outline: 2px solid var(--accent); }
.tabs button[aria-selected=true] { color: var(--text); font-weight: 600; border-bottom-color: var(--accent); }
#testList { padding: 6px 8px 8px; }
#testList button { all: unset; display: block; width: 100%; box-sizing: border-box; padding: 7px 10px; border-radius: 6px; cursor: pointer; content-visibility: auto; contain-intrinsic-size: auto 48px; }
#testList button[hidden] { display: none; }
#testList button:hover { background: var(--bg); }
#testList button:focus-visible { outline: 2px solid var(--accent); }
#testList button[aria-current=true] { background: var(--bg); outline: 1px solid var(--border); }
#testList .title { overflow-wrap: anywhere; }
.bad-text { color: var(--bad); }
.box.target { border-width: 3px; outline: 3px solid var(--accent); outline-offset: 2px; z-index: 3; }
.stepinfo { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; display: grid; gap: 4px; }
.stepinfo .action { font-weight: 600; }
.stepinfo .instance { font-weight: 400; color: var(--muted); margin-left: 4px; overflow-wrap: anywhere; }
.stepinfo code { overflow-wrap: anywhere; }
.steplist { list-style: none; margin: 16px 0 24px; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 6px; }
.steplist button { font: inherit; font-size: 12px; color: var(--text); background: var(--panel); border: 1px solid var(--border); border-radius: 999px; padding: 1px 9px; cursor: pointer; max-width: 32ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.steplist button:hover { background: var(--bg); }
.steplist button[aria-current=true] { border-color: var(--accent); color: var(--accent); font-weight: 600; }
.steplist .n { color: var(--muted); margin-right: 4px; font-variant-numeric: tabular-nums; }
.steplink { font-size: 12px; margin-left: 6px; color: var(--accent); }
</style>
</head>
<body>
<header>
  <h1>UI Coverage</h1>
  <span class="big" id="total"></span>
  <span class="muted" id="totalDetail"></span>
  <span class="muted" style="margin-left:auto" id="generated"></span>
</header>
<div class="layout">
  <nav aria-label="Routes">
    <div class="navtools">
      <div class="tabs" role="tablist" id="tabs" hidden>
        <button role="tab" id="tabViews" data-tab="views" aria-selected="true" aria-controls="viewsPane">Views</button>
        <button role="tab" id="tabTests" data-tab="tests" aria-selected="false" aria-controls="testsPane">Tests <span class="muted" id="testsCount"></span></button>
      </div>
      <input type="search" id="search" placeholder="Filter routes" title="Filter routes (press /)" aria-label="Filter routes" autocomplete="off" spellcheck="false">
      <div class="row">
        <span class="muted" id="navCount"></span>
        <label class="muted" id="sortLabel">Sort <select id="sort" aria-label="Sort routes">
          <option value="name">Name</option>
          <option value="coverage">Lowest coverage</option>
          <option value="untested">Most untested</option>
        </select></label>
      </div>
    </div>
    <div id="viewsPane" role="tabpanel" aria-labelledby="tabViews">
    <button id="insightsNav" aria-current="false"><div class="row"><span>Most repeated elements</span><span class="muted" id="insightsCount"></span></div>
      <div class="sub muted" id="insightsSub"></div></button>
    <div id="navList"></div>
    <p class="muted" id="navEmpty" hidden>No routes match.</p>
    <div id="untestedNav" hidden>
      <div class="navhead" title="Views that links point to but no test visited">Untested views <span id="untestedCount"></span></div>
      <div id="untestedList"></div>
    </div>
    </div>
    <div id="testsPane" role="tabpanel" aria-labelledby="tabTests" hidden>
      <div id="testList"></div>
      <p class="muted" id="testEmpty" hidden style="padding:8px 10px">No tests match.</p>
    </div>
  </nav>
  <main id="main"></main>
</div>
<dialog id="copyDlg" aria-labelledby="copyDlgTitle">
  <div class="row"><strong id="copyDlgTitle">Copy with Ctrl+C / ⌘C</strong><button class="btn" id="copyDlgClose">Close</button></div>
  <textarea readonly spellcheck="false" aria-labelledby="copyDlgTitle"></textarea>
</dialog>
<script id="data" type="application/json">${data}</script>
<script>
const testSkeleton = ${testSkeleton.toString()};
const data = JSON.parse(document.getElementById('data').textContent);
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem('uicov.' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('uicov.' + k, v); } catch {} },
};
const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

$('#total').textContent = data.percent + '%';
const totalLinks = data.totalLinks || 0, testedLinks = data.testedLinks || 0;
const untestedViews = data.untestedViews || [];
const untestedIndex = new Map(untestedViews.map((v, i) => [v.view, i]));
const UNTESTED_HASH = '#untested:';
$('#totalDetail').textContent = (totalLinks
    ? (data.tested - testedLinks) + ' of ' + (data.total - totalLinks) + ' interactive elements and ' + testedLinks + ' of ' + totalLinks + ' links tested'
    : data.tested + ' of ' + data.total + ' interactive elements tested') + ' across ' + data.routes.length + ' routes' +
  (data.failingOnly ? ' (' + data.failingOnly + ' touched only by failing tests)' : '') +
  (untestedViews.length ? ' · ' + plural(untestedViews.length, 'untested view') : '') +
  (data.a11yHints ? ' · ' + plural(data.a11yHints, 'accessibility hint') : '');
$('#generated').textContent = new Date(data.generatedAt).toLocaleString();

// Keep the sticky sidebar below the header, whose height changes when it wraps.
const syncHeader = () => document.documentElement.style.setProperty('--hh', $('header').offsetHeight + 'px');
syncHeader();
addEventListener('resize', syncHeader);

let onlyUntested = store.get('onlyUntested') === '1';
// Untested but touched by failing tests: shown as its own state, not counted.
const failingOnly = (e) => !e.tested && (e.testedByFailing || []).length > 0;
let current = -1;

// ---- Sidebar: rendered once. Search and sort only toggle "hidden" and reorder nodes.
const collator = new Intl.Collator(undefined, { numeric: true });
const items = data.routes.map((r, i) => ({ r, i, name: r.route.toLowerCase(), untested: r.total - r.tested }));
const navList = $('#navList');
navList.innerHTML = items.map(({ r, i, untested }) =>
  '<button data-i="' + i + '" aria-current="false">' +
    '<div class="row"><span class="route">' + esc(r.route) + '</span><span>' + r.percent + '%</span></div>' +
    '<div class="bar"><i style="width:' + r.percent + '%"></i></div>' +
    '<div class="sub muted">' + (untested ? untested + ' untested' : 'all tested') + ' · ' + plural(r.total - (r.totalLinks || 0), 'element') +
      (r.totalLinks ? ' · ' + plural(r.totalLinks, 'link') : '') +
      (r.failingOnly ? ' · <span class="warn-text">' + r.failingOnly + ' failing only</span>' : '') +
      (r.a11yHints ? ' · <span class="a11y-count">' + r.a11yHints + ' a11y</span>' : '') + '</div>' +
  '</button>').join('');
const buttons = Array.from(navList.children);
navList.addEventListener('click', e => {
  const b = e.target.closest('button[data-i]');
  if (b) show(+b.dataset.i, true);
});

const byName = (a, b) => collator.compare(a.r.route, b.r.route);
const sorters = {
  name: byName,
  coverage: (a, b) => a.r.percent - b.r.percent || b.untested - a.untested || byName(a, b),
  untested: (a, b) => b.untested - a.untested || a.r.percent - b.r.percent || byName(a, b),
};
const sortSel = $('#sort');
const search = $('#search');
sortSel.value = sorters[store.get('sort')] ? store.get('sort') : 'name';

function applySort() {
  const frag = document.createDocumentFragment();
  items.slice().sort(sorters[sortSel.value]).forEach(x => frag.appendChild(buttons[x.i]));
  navList.appendChild(frag);
}
function applyFilter() {
  if (tab === 'tests') return filterTests();
  const q = search.value.trim().toLowerCase();
  let n = 0;
  for (const x of items) {
    const hit = !q || x.name.includes(q);
    if (buttons[x.i].hidden === hit) buttons[x.i].hidden = !hit;
    if (hit) n++;
  }
  $('#navCount').textContent = q ? n + ' of ' + items.length + ' routes' : items.length + ' routes';
  $('#navEmpty').hidden = n > 0;
}
const firstVisible = () => navList.querySelector('button:not([hidden])');
let tab = 'views';
sortSel.onchange = () => { store.set('sort', sortSel.value); applySort(); };
search.oninput = applyFilter;
search.onkeydown = e => {
  if (e.key === 'Enter' && tab === 'tests') { const b = testList.querySelector('button:not([hidden])'); if (b) showTest(+b.dataset.a); }
  else if (e.key === 'Enter') { const b = firstVisible(); if (b) show(+b.dataset.i, true); }
  else if (e.key === 'Escape') { search.value = ''; applyFilter(); }
};
addEventListener('keydown', e => {
  if (e.key === '/' && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) { e.preventDefault(); search.focus(); }
});
applySort();
applyFilter();

// ---- Detail: only the selected route is in the DOM.
function placeBoxes(el, r, s, tested) {
  const img = el.querySelector('img');
  const cssW = img.naturalWidth / (s.dpr || 1);
  const cssH = img.naturalHeight / (s.dpr || 1);
  if (!cssW || !cssH) return;
  el.querySelectorAll('.box').forEach(b => b.remove());
  const frag = document.createDocumentFragment();
  s.boxes.forEach((raw, i) => {
    const b = Array.isArray(raw) ? { key: elementAt(r, raw[0]).key, x: raw[1], y: raw[2], w: raw[3], h: raw[4], pos: raw[5] } : raw;
    // The screenshot may be cropped (maxScreenshotHeight): drop or clip boxes outside it.
    if (b.y >= cssH || b.x >= cssW) return;
    const w = Math.min(b.w, cssW - b.x);
    const h = Math.min(b.h, cssH - b.y);
    const info = tested.get(b.key);
    const d = document.createElement('div');
    // Fixed and sticky elements are drawn where they were on screen when the screenshot was taken.
    d.className = 'box' + (info && info.tested ? ' ok' : info && failingOnly(info) ? ' warn' : '') + (b.pos ? ' pinned' : '');
    d.dataset.key = b.key;
    d.dataset.i = i;
    d.title = (info ? info.label : b.key) + (info && info.dests ? ' → ' + info.dests + (info.tested ? ' — destination visited' : ' — destination never visited') :
        info && info.tested ? ' — tested' : info && failingOnly(info) ? ' — failing tests only' : ' — untested') +
      (b.pos ? ' (position: ' + b.pos + ', shown where it was on screen)' : '') +
      (info && info.suggestedLocator ? '\\n' + info.suggestedLocator + '\\n(click to show it in the table)' : '');
    d.style.cssText = 'left:' + (b.x / cssW * 100) + '%;top:' + (b.y / cssH * 100) + '%;width:' + (w / cssW * 100) + '%;height:' + (h / cssH * 100) + '%';
    frag.appendChild(d);
  });
  el.appendChild(frag);
  el.classList.add('loaded');
}

// Box index: elements first, then the <a> elements of link units.
const elementAt = (r, i) => i < r.elements.length ? r.elements[i] : r.linkEls[i - r.elements.length];
const linkEls = (r) => r.linkEls || [];
const linksOf = (r) => r.links || [];
// What a box shows: elements by their own state; a link's <a> by its destinations (tested when all were visited).
function boxInfo(r) {
  const m = new Map(r.elements.map(e => [e.key, e]));
  const units = new Map();
  for (const l of linksOf(r)) for (const j of l.refs) {
    const e = linkEls(r)[j];
    if (!units.has(e.key)) units.set(e.key, { label: e.label, suggestedLocator: e.suggestedLocator, testedBy: [], tested: true, dests: [] });
    const u = units.get(e.key);
    u.tested = u.tested && l.tested;
    u.dests.push(l.key);
  }
  for (const [k, u] of units) m.set(k, { ...u, dests: u.dests.join(', ') });
  return m;
}
const findLocator = (r, key) => (r.elements.find(x => x.key === key) || linkEls(r).find(x => x.key === key) || {}).suggestedLocator;
// The row of an element, or the referrer entry in a link unit's row.
const rowOf = (key) => $('#main').querySelector('tr[data-key="' + CSS.escape(key) + '"], tr .ref[data-key="' + CSS.escape(key) + '"]');
// Lines for "Copy untested as test skeleton": untested elements, then one link per untested destination.
const skeletonLines = (r) => r.elements.filter(x => !x.tested && x.suggestedLocator).map(x => x.suggestedLocator).concat(
  linksOf(r).filter(l => !l.tested).map(l => l.refs.map(j => linkEls(r)[j].suggestedLocator).find(Boolean)).filter(Boolean));
function viewLink(name) {
  if (routeIndex.has(name)) return '<a class="goto route" href="#' + esc(encodeURIComponent(name)) + '" data-route="' + esc(name) + '">' + esc(name) + '</a>';
  if (untestedIndex.has(name)) return '<a class="goto route" href="' + esc(UNTESTED_HASH + encodeURIComponent(name)) + '" data-untested="' + untestedIndex.get(name) + '">' + esc(name) + '</a>';
  return '<span class="route">' + esc(name) + '</span>';
}
const urlList = (urls, count) => urls.map(esc).join('<br>') + (count > urls.length ? '<br><span class="muted">… and ' + (count - urls.length) + ' more</span>' : '');
function linkRows(r) {
  return linksOf(r).map(l =>
    '<tr class="' + (l.tested ? 'ok' : 'bad') + '">' +
      '<td><span class="pill ' + (l.tested ? 'ok" title="A test visited this view">tested' : 'bad" title="No test visited this view">untested') + '</span></td>' +
      '<td>' + viewLink(l.key) + '</td>' +
      '<td>' + l.refs.map(j => {
        const e = linkEls(r)[j];
        return '<div class="ref" data-key="' + esc(e.key) + '">' + esc(e.label) + (e.instances > 1 ? ' <span class="muted">×' + e.instances + '</span>' : '') +
          '<br><code class="muted">' + esc(e.key) + '</code>' +
          (e.a11yHints || []).map(h => '<div class="a11y" title="Accessibility hint (informational, not part of the coverage score)">' + esc(h) + '</div>').join('') +
          (!l.tested && e.suggestedLocator ? '<div class="snip"><code>' + esc(e.suggestedLocator) + '</code><button class="btn" data-copy="' + esc(e.key) + '" title="Copy this line">Copy</button></div>' : '') +
          '</div>';
      }).join('') + '</td>' +
      '<td class="urls">' + urlList(l.destinations, l.destinationCount) + '</td>' +
    '</tr>').join('');
}

// Overlay boxes are placed only once each (lazy) image has loaded.
function wireShot(el, r, s, tested, placed) {
  const img = el.querySelector('img');
  const place = () => { placeBoxes(el, r, s, tested); if (placed) placed(); };
  if (img.complete && img.naturalWidth) place();
  else {
    img.addEventListener('load', place, { once: true });
    img.addEventListener('error', () => el.classList.add('loaded', 'missing'), { once: true });
  }
}

// ---- Screenshots of a route: the overview (the best few) or every state, one at a time.
let shotMode = store.get('shotMode') === 'states' ? 'states' : 'best';
let stateAt = 0;
// Data loaded on demand from steps/ (script tags, so it works from file://).
const lazy = new Map();
window.__uicovData = (kind, i, payload) => { const e = lazy.get(kind + '-' + i); if (e) e.resolve(payload); };
function loadLazy(kind, i) {
  const k = kind + '-' + i;
  if (!lazy.has(k)) {
    const e = {};
    e.promise = new Promise((resolve, reject) => { e.resolve = resolve; e.reject = reject; });
    lazy.set(k, e);
    const s = document.createElement('script');
    s.src = 'steps/' + k + '.js';
    s.onerror = () => { lazy.delete(k); s.remove(); e.reject(new Error('not found')); };
    document.head.appendChild(s);
  }
  return lazy.get(k).promise;
}
function renderShots(i, tested) {
  const r = data.routes[i];
  const area = $('#shotArea');
  if (!area) return;
  const mode = r.stateCount ? shotMode : 'best';
  $('#main').querySelectorAll('.seg button[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  const hint = $('#viewsHint');
  if (hint) hint.innerHTML = mode === 'states' ? '<span class="kbd">←</span> <span class="kbd">→</span> to step through' : 'The screenshots that show the most elements';
  if (mode === 'best') {
    area.innerHTML = r.screenshots.length ? '<div class="shots">' + r.screenshots.map((s, si) =>
      '<figure><div class="shot" data-si="' + si + '"><img loading="lazy" decoding="async" src="' + esc(s.source) + '" alt="Screenshot of ' + esc(r.route) + '"></div>' +
      '<figcaption>' + (s.viewport ? 'viewport, right after an interaction · ' : '') + 'from: ' + esc(s.test) + '</figcaption></figure>').join('') + '</div>' : '';
    area.querySelectorAll('.shot').forEach(el => wireShot(el, r, r.screenshots[+el.dataset.si], tested));
    setHash(r);
    return;
  }
  area.innerHTML = '<div class="stepper"><p class="muted">Loading states…</p></div>';
  loadLazy('view', i).then(payload => {
    if (current !== i || shotMode !== 'states' || !$('#shotArea')) return;
    states = payload.states;
    showState(i, Math.min(stateAt, states.length - 1), tested);
  }, () => { if (current === i) area.innerHTML = '<p class="muted">The states of this view weren’t found (steps/view-' + i + '.js).</p>'; });
}
let states = null;
const setHash = (r, k) => { try { history.replaceState(null, '', '#' + encodeURIComponent(r.route) + (k != null ? '&state=' + (k + 1) : '')); } catch {} };
function showState(i, k, tested) {
  const r = data.routes[i];
  const n = states.length;
  if (k < 0 || k >= n) return;
  stateAt = k;
  const st = states[k];
  const pct = st.total ? Math.round(st.tested / st.total * 1000) / 10 : 100;
  const area = $('#shotArea');
  area.innerHTML = '<div class="stepper">' +
    '<div class="stepbar"><button class="btn" data-state-step="-1" title="Previous state (←)" aria-label="Previous state"' + (k === 0 ? ' disabled' : '') + '>◀</button>' +
      '<span class="pos">State <b>' + (k + 1) + '</b> of ' + n + '</span>' +
      '<button class="btn" data-state-step="1" title="Next state (→)" aria-label="Next state"' + (k === n - 1 ? ' disabled' : '') + '>▶</button>' +
      '<span class="muted">' + st.tested + ' of ' + plural(st.total, 'element') + ' in this state tested (' + pct + '%)</span></div>' +
    '<figure><div class="shot"><img decoding="async" src="' + esc(st.source) + '" alt="State ' + (k + 1) + ' of ' + esc(r.route) + '"></div>' +
      '<figcaption class="reached">' + (st.viewport ? 'viewport' : 'full page') + (st.t ? ' · ' + new Date(st.t).toLocaleTimeString() : '') +
      ' · Reached by: ' + st.attempts.map(a => attemptItem(data.attempts[a])).join(', ') + '</figcaption></figure></div>';
  area.querySelectorAll('[data-state-step]').forEach(b => b.onclick = () => showState(i, stateAt + +b.dataset.stateStep, tested));
  wireShot(area.querySelector('.shot'), r, st, tested);
  // The neighbours load in the background, so stepping is instant.
  [k - 1, k + 1].forEach(j => { if (states[j]) new Image().src = states[j].source; });
  setHash(r, k);
}
// A test attempt, linked to the HTML report and its trace like "Tested by".
function attemptItem(a) {
  if (!a) return '';
  const t = a.test != null ? tests[a.test] : null;
  const label = t ? testItem({ ...t, run: a.run, trace: a.trace }, !!a.failed) : esc(a.title) + (a.failed ? ' (failed)' : '');
  const i = data.attempts.indexOf(a);
  return label + (a.run ? ' <span class="muted">(retry #' + a.run + ')</span>' : '') +
    (a.steps ? '<a class="steplink" href="' + TEST_HASH + i + '" data-attempt="' + i + '" title="Step through this test">steps</a>' : '');
}
const stepping = () => current >= 0 && shotMode === 'states' && states && $('#main .stepper .stepbar');
addEventListener('keydown', e => {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
  const by = e.key === 'ArrowLeft' ? -1 : 1;
  if (walking()) { e.preventDefault(); showStep(currentTest, stepAt + by); return; }
  if (!stepping()) return;
  e.preventDefault();
  showState(current, stateAt + by, boxInfo(data.routes[current]));
});

function show(i, fromUser, focusKey, state) {
  const r = data.routes[i];
  if (!r) { $('#main').innerHTML = '<p class="muted">No coverage data.</p>'; return; }
  try { history.replaceState(null, '', '#' + encodeURIComponent(r.route)); } catch {}
  clearCurrent();
  states = null;
  setTab('views');
  current = i;
  buttons[i].setAttribute('aria-current', 'true');
  if (!fromUser) buttons[i].scrollIntoView({ block: 'nearest' });

  const tested = boxInfo(r);
  if (state !== undefined) shotMode = 'states';
  stateAt = state || 0;
  const shots = r.screenshots.length || r.stateCount;
  const rows = sortedElements(r.elements).map(e =>
    '<tr class="' + (e.tested ? 'ok' : 'bad') + '" data-key="' + esc(e.key) + '">' +
      '<td><span class="pill ' + (e.tested ? 'ok" title="' + esc(countsText(e)) + '">tested' : failingOnly(e) ? 'warn" title="Touched only by tests that did not pass; not counted as tested">failing tests only' : 'bad">untested') + '</span></td>' +
      '<td>' + esc(e.label) + instancesText(e) + (e.key !== e.label ? '<br><code class="muted">' + esc(e.key) + '</code>' : '') +
        (e.a11yHints || []).map(h => '<div class="a11y" title="Accessibility hint (informational, not part of the coverage score)">' + esc(h) + '</div>').join('') +
        (!e.tested && e.suggestedLocator ? '<div class="snip"><code>' + esc(e.suggestedLocator) + '</code><button class="btn" data-copy="' + esc(e.key) + '" title="Copy this line">Copy</button></div>' : '') +
      '</td>' +
      insightCells(e) +
      '<td class="muted tests">' + testedByCell(e) + '</td>' +
    '</tr>').join('');
  const main = $('#main');
  litKey = null; lit = [];
  main.className = onlyUntested ? 'only-untested' : '';
  main.innerHTML =
    '<div class="toolbar"><span class="route big">' + esc(r.route) + '</span>' +
    '<span class="muted">' + r.tested + '/' + r.total + ' tested (' + r.percent + '%)' +
      (r.totalLinks ? ': ' + (r.tested - r.testedLinks) + '/' + (r.total - r.totalLinks) + ' elements, ' + r.testedLinks + '/' + r.totalLinks + ' links' : '') + '</span>' +
    (r.a11yHints ? '<span class="a11y-count" title="Informational; not part of the coverage score">' + plural(r.a11yHints, 'accessibility hint') + '</span>' : '') +
    '<span style="margin-left:auto"></span>' +
    (skeletonLines(r).length ? '<button class="btn" data-copy="skeleton" title="A test that visits this route and touches each untested element and link">Copy untested as test skeleton</button>' : '') +
    '<label><input type="checkbox" id="only"' + (onlyUntested ? ' checked' : '') + '> Untested only</label></div>' +
    (r.stateCount
      ? '<div class="views"><span class="seg" role="group" aria-label="Screenshots">' +
          '<button data-mode="best" title="The screenshots that show the most elements">Overview</button>' +
          '<button data-mode="states" title="Every state of this view the tests reached, in the order they reached it">All states (' + r.stateCount + ')</button></span>' +
          '<span class="muted" id="viewsHint"></span></div>'
      : '') +
    (shots ? '<div id="shotArea"></div>' : '') +
    (r.elements.length ? '<div class="table-wrap"><table class="els"><thead><tr><th>Status</th><th>Element</th>' + insightHeaders() + '<th>Tested by</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '') +
    (linksOf(r).length
      ? '<h2 class="section">Links <span class="muted">' + (r.totalLinks - r.testedLinks) + ' untested of ' + r.totalLinks + '</span></h2>' +
        '<p class="hint">Links of this route, grouped by the view they lead to. A destination counts as tested when any test visited it, not necessarily through these links. ' +
        'Links within the route (<code>#fragment</code>, the route itself) are elements above.</p>' +
        '<div class="table-wrap"><table class="links"><thead><tr><th>Status</th><th>Destination</th><th>Referrers</th><th>URLs</th></tr></thead><tbody>' + linkRows(r) + '</tbody></table></div>'
      : '');
  main.querySelectorAll('th[data-sort] button').forEach(b => b.onclick = () => setRowSort(r, b.parentNode.dataset.sort));

  $('#only').onchange = (e) => {
    onlyUntested = e.target.checked;
    store.set('onlyUntested', onlyUntested ? '1' : '0');
    main.className = onlyUntested ? 'only-untested' : '';
  };

  main.querySelectorAll('.seg button[data-mode]').forEach(b => b.onclick = () => {
    if (shotMode === b.dataset.mode) return;
    shotMode = b.dataset.mode;
    store.set('shotMode', shotMode);
    stateAt = 0;
    renderShots(i, tested);
  });
  if (shots) renderShots(i, tested);

  wireGoto(main);
  const focusRow = focusKey != null && rowOf(focusKey);
  if (focusRow) { focusRow.classList.add('picked'); focusRow.scrollIntoView({ block: 'center' }); }
  else if (fromUser) {
    const top = main.getBoundingClientRect().top;
    if (top < 0 || top > innerHeight * 0.6) main.scrollIntoView({ block: 'start' });
  }
}

// ---- Insights: interaction/test counts, "Tested by" links, most repeated elements.
const tests = data.tests || [];
const multiProject = new Set(tests.map(t => t.project)).size > 1;
const sumCounts = (c) => Object.values(c || {}).reduce((s, n) => s + n, 0);
const interactionsOf = (e) => e.interactionTotal != null ? e.interactionTotal : sumCounts(e.interactionCounts);
const testsOf = (e) => e.testCount != null ? e.testCount : e.testedBy.length;
// "(3 instances · name)" after the label, with why the elements were grouped as the tooltip.
const GROUP_REASONS = { markup: 'data-uicov-group', config: 'elementGroups', 'same-key': 'same key', row: 'same column in a table', repeated: 'repeated structure', label: 'label and its control' };
const instancesText = (e) => {
  const g = e.group;
  const n = g && g.reason !== 'label' ? Math.max(e.instances, g.members) : e.instances;
  const parts = [];
  if (n > 1) parts.push(n + ' instances');
  if (g && g.name) parts.push(esc(g.name));
  if (g && g.reason === 'label') parts.push('with its label');
  if (!parts.length) return '';
  const why = g ? 'Grouped: ' + (GROUP_REASONS[g.reason] || g.reason) + (g.name ? ' "' + g.name + '"' : '') + '; counts once' : '';
  return ' <span class="muted"' + (why ? ' title="' + esc(why) + '"' : '') + '>(' + parts.join(' · ') + ')</span>';
};
// "click ×3, input ×1", shown as the tooltip of the "tested" pill and the Interactions cell.
const countsText = (e) => Object.entries(e.interactionCounts || {}).map(([t, n]) => t + ' ×' + n).join(', ');
const rowSorters = {
  interactions: (a, b) => interactionsOf(b) - interactionsOf(a) || testsOf(b) - testsOf(a),
  tests: (a, b) => testsOf(b) - testsOf(a) || interactionsOf(b) - interactionsOf(a),
};
let rowSort = rowSorters[store.get('rowSort')] ? store.get('rowSort') : '';
// Stable sort: ties keep the default order (untested first, then by label).
const sortedElements = (els) => rowSort ? els.slice().sort(rowSorters[rowSort]) : els;
function insightHeaders() {
  const th = (k, label, tip) => '<th class="num" data-sort="' + k + '"' + (rowSort === k ? ' aria-sort="descending"' : '') +
    '><button title="' + tip + '">' + label + '</button></th>';
  return th('interactions', 'Interactions', 'Counted interactions, all types. Click to sort, again to reset') +
    th('tests', 'Tests', 'Distinct tests that interacted with it. Click to sort, again to reset');
}
function insightCells(e) {
  if (!e.tested) return '<td class="num muted">—</td><td class="num muted">—</td>';
  return '<td class="num" title="' + esc(countsText(e)) + '">' + interactionsOf(e) + '</td><td class="num">' + testsOf(e) + '</td>';
}
function setRowSort(r, key) {
  rowSort = rowSort === key ? '' : key;
  store.set('rowSort', rowSort);
  const main = $('#main');
  main.querySelectorAll('th[data-sort]').forEach(th => {
    if (th.dataset.sort === rowSort) th.setAttribute('aria-sort', 'descending'); else th.removeAttribute('aria-sort');
  });
  const tbody = main.querySelector('table.els tbody');
  const byKey = new Map(Array.from(tbody.children, tr => [tr.dataset.key, tr]));
  const frag = document.createDocumentFragment();
  sortedElements(r.elements).forEach(e => frag.appendChild(byKey.get(e.key)));
  tbody.appendChild(frag);
}

// Links into Playwright's HTML report. Relative, so both folders can be moved together.
const pw = data.htmlReport;
const testHref = (t) => pw.path + '/index.html#?' + new URLSearchParams({ testId: t.id, run: String(t.run) });
function traceHref(t) {
  const base = /^[a-z][a-z0-9+.-]*:/i.test(pw.attachmentsBaseURL) ? pw.attachmentsBaseURL : pw.path + '/' + pw.attachmentsBaseURL;
  // Same as the HTML report's own trace links: its bundled trace viewer, given an absolute trace URL.
  return pw.path + '/trace/index.html?trace=' + encodeURIComponent(new URL(base + t.trace, location.href).href);
}
function testItem(t, failed) {
  const name = esc(t.title) + (multiProject && t.project ? ' <span class="muted">[' + esc(t.project) + ']</span>' : '');
  if (!pw) return name + (failed ? ' (failed)' : '');
  const run = t.run ? ' (retry #' + t.run + ')' : '';
  return '<a href="' + esc(testHref(t)) + '" target="_blank" rel="noopener" title="Open in the Playwright HTML report' + run + '">' + name + '</a>' +
    (failed ? ' (failed)' : '') +
    (t.trace ? '<a class="trace" href="' + esc(traceHref(t)) + '" target="_blank" rel="noopener" title="Open the trace' + run + ' in the HTML report’s trace viewer">trace</a>' : '');
}
function testedByCell(e) {
  if (!e.ti) return e.testedBy.map(esc).concat((e.testedByFailing || []).map(t => esc(t) + ' (failed)')).join('<br>') || '—';
  return e.ti.map((i, j) => testItem(tests[i], false) + stepLink(e.ts && e.ts[j]))
    .concat((e.tf || []).map(i => testItem(tests[i], true))).join('<br>') || '—';
}
// A link to the step of the test's walkthrough that acted on the element.
const stepLink = (at) => at ? '<a class="steplink" href="' + TEST_HASH + at[0] + '&step=' + (at[1] + 1) + '" data-attempt="' + at[0] + '" data-step="' + at[1] + '" title="Show this step of the test">step ' + (at[1] + 1) + '</a>' : '';

// "Most repeated": elements used by the most tests, often setup steps such as signing in.
const repeated = data.mostRepeated || [];
const routeIndex = new Map(data.routes.map((r, i) => [r.route, i]));
const insightsNav = $('#insightsNav');
$('#insightsCount').textContent = String(repeated.length);
$('#insightsSub').textContent = repeated.length ? 'Up to ' + repeated[0].tests + ' tests per element' : 'None used by several tests';
const REPEATED_HASH = '#/insights/repeated';
function showRepeated() {
  try { history.replaceState(null, '', REPEATED_HASH); } catch {}
  clearCurrent();
  current = -1;
  insightsNav.setAttribute('aria-current', 'true');
  const rows = repeated.map(x =>
    '<tr><td>' + esc(x.label) + (x.key !== x.label ? '<br><code class="muted">' + esc(x.key) + '</code>' : '') + '</td>' +
    '<td><a class="goto route" href="#' + esc(encodeURIComponent(x.route)) + '" data-route="' + esc(x.route) + '" data-key="' + esc(x.key) + '">' + esc(x.route) + '</a></td>' +
    '<td class="num">' + x.tests + ' <span class="muted">(' + x.share + '%)</span></td><td class="num">' + x.interactions + '</td></tr>').join('');
  const main = $('#main');
  litKey = null; lit = [];
  main.className = '';
  main.innerHTML =
    '<div class="toolbar"><span class="big">Most repeated elements</span><span class="muted">' + (tests.length ? tests.length + ' tests in this report' : '') + '</span></div>' +
    (repeated.length
      ? '<p class="hint">Elements used by many tests are often setup steps, like signing in or creating data. ' +
        'When a test isn’t about that step, doing it once can make the suite faster: ' +
        '<a href="https://playwright.dev/docs/auth" target="_blank" rel="noopener">sign in once and reuse the <code>storageState</code></a> from a setup project, or ' +
        '<a href="https://playwright.dev/docs/api-testing#using-request-context" target="_blank" rel="noopener">prepare data through the API</a>. ' +
        'Keep one test that goes through the UI for the step itself.</p>' +
        '<div class="table-wrap"><table><thead><tr><th>Element</th><th>Route</th><th class="num" title="Distinct tests (share of all tests)">Tests</th><th class="num">Interactions</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<p class="muted">No element is used by more than one test.</p>');
  wireGoto(main);
}
insightsNav.onclick = showRepeated;

// Links to a route (optionally to one of its elements) or to an untested view.
function wireGoto(root) {
  root.querySelectorAll('a.goto').forEach(a => a.onclick = (ev) => {
    if (a.dataset.untested !== undefined) { ev.preventDefault(); showUntested(+a.dataset.untested); return; }
    const i = routeIndex.get(a.dataset.route);
    if (i === undefined) return;
    ev.preventDefault();
    show(i, true, a.dataset.key, a.dataset.state != null ? +a.dataset.state : undefined);
  });
}

// ---- Untested views: link destinations no test visited.
const untestedNav = $('#untestedNav');
const untestedList = $('#untestedList');
let currentUntested = -1;
function clearCurrent() {
  if (testButtons[currentTest]) testButtons[currentTest].setAttribute('aria-current', 'false');
  currentTest = -1;
  walk = null;
  insightsNav.setAttribute('aria-current', 'false');
  if (buttons[current]) buttons[current].setAttribute('aria-current', 'false');
  if (untestedList.children[currentUntested]) untestedList.children[currentUntested].setAttribute('aria-current', 'false');
  currentUntested = -1;
}
if (untestedViews.length) {
  untestedNav.hidden = false;
  $('#untestedCount').textContent = '(' + untestedViews.length + ')';
  untestedList.innerHTML = untestedViews.map((v, i) =>
    '<button data-u="' + i + '" aria-current="false"><div class="route">' + esc(v.view) + '</div>' +
    '<div class="sub muted">linked from ' + plural(v.referrers.length, 'route') + '</div></button>').join('');
  untestedList.addEventListener('click', e => {
    const b = e.target.closest('button[data-u]');
    if (b) showUntested(+b.dataset.u);
  });
}
function showUntested(i) {
  const v = untestedViews[i];
  if (!v) return;
  try { history.replaceState(null, '', UNTESTED_HASH + encodeURIComponent(v.view)); } catch {}
  clearCurrent();
  current = -1;
  currentUntested = i;
  untestedList.children[i].setAttribute('aria-current', 'true');
  const rows = v.referrers.map(x => {
    const r = data.routes[routeIndex.get(x.route)];
    const els = r ? x.keys.map(k => linkEls(r).find(e => e.key === k)).filter(Boolean) : [];
    return '<tr class="bad"><td>' + viewLink(x.route) + '</td><td>' +
      (els.length ? els.map(e => '<div class="ref">' + esc(e.label) + (e.instances > 1 ? ' <span class="muted">×' + e.instances + '</span>' : '') +
        '<br><code class="muted">' + esc(e.key) + '</code>' +
        (e.suggestedLocator ? '<div class="snip"><code>' + esc(e.suggestedLocator) + '</code></div>' : '') + '</div>').join('') : esc(x.label)) + '</td></tr>';
  }).join('');
  const main = $('#main');
  litKey = null; lit = [];
  main.className = '';
  main.innerHTML =
    '<div class="toolbar"><span class="route big">' + esc(v.view) + '</span><span class="pill bad">untested view</span></div>' +
    '<p class="hint">No test visited this view; these routes link to it. A test that opens it (by any path) makes these links tested, and its elements appear in the report.</p>' +
    '<h2 class="section">Referrers</h2>' +
    '<div class="table-wrap"><table><thead><tr><th>Route</th><th>Links</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<h2 class="section">URLs <span class="muted">' + v.destinationCount + '</span></h2>' +
    '<div class="table-wrap"><table><tbody><tr><td class="urls">' + urlList(v.destinations, v.destinationCount) + '</td></tr></tbody></table></div>';
  wireGoto(main);
}

// ---- Hovering a row or box highlights every node with the same key.
let lit = [];
let litKey = null;
const highlight = (key) => {
  lit.forEach(n => n.classList.remove('hl'));
  lit = key == null ? [] : Array.from($('#main').querySelectorAll('[data-key="' + CSS.escape(key) + '"]'));
  lit.forEach(n => n.classList.add('hl'));
};
$('#main').addEventListener('mouseover', e => {
  const k = e.target.closest('[data-key]');
  const key = k ? k.dataset.key : null;
  if (key !== litKey) { litKey = key; highlight(key); }
});
$('#main').addEventListener('mouseleave', () => { litKey = null; highlight(null); });

// ---- Copy buttons. The Clipboard API can be missing (e.g. some browsers on file://):
// fall back to execCommand, then to a dialog with the text selected.
const copyDlg = $('#copyDlg');
$('#copyDlgClose').onclick = () => copyDlg.close();
async function copyText(text, btn) {
  let ok = false;
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; } } catch {}
  if (!ok) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
  }
  if (ok) {
    const label = btn.textContent;
    btn.textContent = 'Copied';
    btn.classList.add('done');
    setTimeout(() => { btn.textContent = label; btn.classList.remove('done'); }, 1200);
    return;
  }
  const area = copyDlg.querySelector('textarea');
  area.value = text;
  area.rows = Math.min(24, text.split('\\n').length + 1);
  if (typeof copyDlg.showModal === 'function') copyDlg.showModal(); else copyDlg.setAttribute('open', '');
  area.focus();
  area.select();
}
$('#main').addEventListener('click', e => {
  const sl = e.target.closest('a[data-attempt]');
  if (sl) {
    e.preventDefault();
    showTest(+sl.dataset.attempt, sl.dataset.step != null ? +sl.dataset.step : undefined);
    return;
  }
  const btn = e.target.closest('button[data-copy]');
  if (btn) {
    const r = data.routes[current];
    const text = btn.dataset.copy === 'skeleton' ? testSkeleton(r.route, skeletonLines(r)) : findLocator(r, btn.dataset.copy);
    copyText(text, btn);
    return;
  }
  // Clicking a box on a screenshot scrolls to its row (where the copy button is).
  const box = e.target.closest('.box');
  if (box) {
    const hit = rowOf(box.dataset.key);
    const row = hit && hit.closest('tr');
    if (row) {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      row.classList.remove('flash');
      void row.offsetWidth;
      row.classList.add('flash');
    }
  }
});

// ---- Tests: one walkthrough per attempt, its steps one at a time.
const TEST_HASH = '#test:';
const attempts = data.attempts || [];
const attemptTitle = (a) => a.test != null ? tests[a.test].title : a.title;
const attemptProject = (a) => a.test != null ? tests[a.test].project : a.project;
const testList = $('#testList');
// Sorted by title, retries in order.
const testOrder = attempts.map((a, i) => i).sort((x, y) => collator.compare(attemptTitle(attempts[x]), attemptTitle(attempts[y])) || attempts[x].run - attempts[y].run);
testList.innerHTML = testOrder.map(i => {
  const a = attempts[i];
  const status = a.failed ? '<span class="bad-text">failed</span>' : a.ignored ? 'passed, not counted' : 'passed';
  return '<button data-a="' + i + '" aria-current="false"><div class="title">' + esc(attemptTitle(a)) +
    (multiProject && attemptProject(a) ? ' <span class="muted">[' + esc(attemptProject(a)) + ']</span>' : '') + '</div>' +
    '<div class="sub muted">' + (a.run ? 'retry #' + a.run + ' · ' : '') + status + ' · ' + (a.steps ? plural(a.steps, 'step') : 'no steps') + '</div></button>';
}).join('');
const testButtons = [];
testList.querySelectorAll('button[data-a]').forEach(b => testButtons[+b.dataset.a] = b);
testList.addEventListener('click', e => { const b = e.target.closest('button[data-a]'); if (b) showTest(+b.dataset.a); });
const withSteps = attempts.filter(a => a.steps).length;
if (withSteps) {
  $('#tabs').hidden = false;
  $('#testsCount').textContent = String(attempts.length);
}
function filterTests() {
  const q = search.value.trim().toLowerCase();
  let n = 0;
  for (const i of testOrder) {
    const hit = !q || attemptTitle(attempts[i]).toLowerCase().includes(q);
    testButtons[i].hidden = !hit;
    if (hit) n++;
  }
  $('#navCount').textContent = (q ? n + ' of ' : '') + plural(attempts.length, 'test run');
  $('#testEmpty').hidden = n > 0;
}
function setTab(name) {
  if (tab === name) return;
  tab = name;
  $('#tabs').querySelectorAll('button[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  $('#viewsPane').hidden = name !== 'views';
  $('#testsPane').hidden = name !== 'tests';
  $('#sortLabel').style.display = name === 'views' ? '' : 'none';
  search.placeholder = name === 'tests' ? 'Filter tests' : 'Filter routes';
  search.setAttribute('aria-label', search.placeholder);
  applyFilter();
}
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });

let currentTest = -1;
let walk = null;
let stepAt = 0;
// Which screenshot a step shows: the page before it (with the element it acts on) or after it.
let stepView = 'auto';
const walking = () => currentTest >= 0 && walk && walk.steps.length && $('#main .walk');
const testOfHash = () => {
  const m = /^#test:(\\d+)(?:&step=(\\d+))?$/.exec(location.hash);
  return m && attempts[+m[1]] ? { a: +m[1], step: m[2] ? +m[2] - 1 : undefined } : { a: -1 };
};
function showTest(a, step) {
  const at = attempts[a];
  if (!at) return;
  clearCurrent();
  current = -1;
  states = null;
  currentTest = a;
  setTab('tests');
  testButtons[a].setAttribute('aria-current', 'true');
  testButtons[a].scrollIntoView({ block: 'nearest' });
  const main = $('#main');
  litKey = null; lit = [];
  main.className = '';
  const t = at.test != null ? tests[at.test] : null;
  main.innerHTML =
    '<div class="toolbar"><span class="big">' + esc(attemptTitle(at)) + '</span>' +
      (at.run ? '<span class="muted">retry #' + at.run + '</span>' : '') +
      '<span class="pill ' + (at.failed ? 'bad">failed' : 'ok">passed') + '</span>' +
      (at.ignored ? '<span class="muted" title="Another attempt of this test passed later; its interactions count instead">not counted</span>' : '') +
      (t && pw ? '<span class="tests"><a href="' + esc(testHref({ ...t, run: at.run })) + '" target="_blank" rel="noopener">Open in the HTML report</a>' +
        (at.trace ? '<a class="trace" href="' + esc(traceHref({ trace: at.trace })) + '" target="_blank" rel="noopener">trace</a>' : '') + '</span>' : '') +
    '</div><div class="walk">' + (at.steps ? '<p class="muted">Loading steps…</p>' : '<p class="muted">No steps were recorded for this test. Turn on the recording option <code>steps</code> to record them.</p>') + '</div>';
  if (!at.steps) { setTestHash(a); return; }
  loadLazy('test', a).then(payload => {
    if (currentTest !== a) return;
    walk = payload;
    stepView = 'auto';
    showStep(a, Math.max(0, Math.min(step || 0, walk.steps.length - 1)));
  }, () => { if (currentTest === a) $('#main .walk').innerHTML = '<p class="muted">The steps of this test weren’t found (steps/test-' + a + '.js).</p>'; });
}
const setTestHash = (a, k) => { try { history.replaceState(null, '', TEST_HASH + a + (k != null ? '&step=' + (k + 1) : '')); } catch {} };
const pathOf = (url) => { try { const u = new URL(url); return u.pathname + u.search + u.hash; } catch { return url; } };
// "click button "Save"", "load /users"
const stepText = (st) => st.event + ' ' + (st.event === 'load' ? pathOf(st.url) : (st.label || '') + (st.instance ? ' (' + st.instance + ')' : ''));
const callText = (c) => c.api + (c.locator ? ' ' + c.locator : '') + (c.arg ? ' ' + JSON.stringify(c.arg) : '');
function showStep(a, k) {
  const n = walk.steps.length;
  if (k < 0 || k >= n) return;
  stepAt = k;
  const st = walk.steps[k];
  const has = (id) => id && walk.states[id];
  const contains = (id) => has(id) && st.key != null && walk.states[id].boxes.some(b => {
    const r = data.routes[+id.split('.')[0]];
    return (Array.isArray(b) ? elementAt(r, b[0]).key : b.key) === st.key;
  });
  // By default the page before the step when it shows the element acted on, else after.
  const view = stepView !== 'auto' && has(stepView === 'before' ? st.before : st.after) ? stepView
    : contains(st.before) || !has(st.after) ? 'before' : 'after';
  const id = view === 'before' ? st.before : st.after;
  const r = st.route != null ? data.routes[st.route] : null;
  const stateOf = (sid) => sid && +sid.split('.')[0] === st.route ? +sid.split('.')[1] : undefined;
  const linkState = stateOf(st.after) != null ? stateOf(st.after) : stateOf(st.before);
  const c = st.call;
  const shot = has(id) ? walk.states[id] : null;
  const shotRoute = shot ? data.routes[+id.split('.')[0]] : null;
  const marked = shot && contains(id);
  $('#main .walk').innerHTML =
    '<div class="stepbar"><button class="btn" data-walk-step="-1" title="Previous step (←)" aria-label="Previous step"' + (k === 0 ? ' disabled' : '') + '>◀</button>' +
      '<span class="pos">Step <b>' + (k + 1) + '</b> of ' + n + '</span>' +
      '<button class="btn" data-walk-step="1" title="Next step (→)" aria-label="Next step"' + (k === n - 1 ? ' disabled' : '') + '>▶</button>' +
      '<span class="muted"><span class="kbd">←</span> <span class="kbd">→</span></span>' +
      (has(st.before) && has(st.after) ? '<span class="seg" role="group" aria-label="Screenshot" style="margin-left:auto">' +
        '<button data-view="before" aria-pressed="' + (view === 'before') + '" title="The page when the step acted on it">Before</button>' +
        '<button data-view="after" aria-pressed="' + (view === 'after') + '" title="The page right after the step">After</button></span>' : '') +
    '</div>' +
    '<div class="stepinfo"><div class="action">' + esc(st.event) + ' ' + (st.event === 'load' ? '<span class="route">' + esc(pathOf(st.url)) + '</span>' : esc(st.label || '(element not in the report)') +
        (st.instance ? ' <span class="instance" title="Which of the repeated elements it acted on">' + esc(st.instance) + '</span>' : '')) + '</div>' +
      (c ? '<div><code>' + esc(callText(c)) + '</code>' + (c.file ? ' <span class="muted">at ' + esc(c.file + ':' + c.line + (c.column ? ':' + c.column : '')) + '</span>' : '') + '</div>' : '') +
      '<div class="muted">' + (r ? 'View ' + '<a class="goto route" href="#' + esc(encodeURIComponent(r.route)) + '" data-route="' + esc(r.route) + '"' +
        (linkState != null ? ' data-state="' + linkState + '"' : '') + ' title="Show this view' + (linkState != null ? ' at this state' : '') + '">' + esc(r.route) + '</a> · ' : '') +
        '<span class="urls">' + esc(st.url) + '</span></div></div>' +
    (shot
      ? '<figure><div class="shot"><img decoding="async" src="' + esc(shot.source) + '" alt="The page ' + view + ' step ' + (k + 1) + '"></div>' +
        '<figcaption>' + (view === 'before' ? 'Before this step' : 'After this step') +
        (st.key != null && !marked ? ' · the element it acted on isn’t in this screenshot' : st.key != null ? ' · the element it acted on is outlined in blue' : '') + '</figcaption></figure>'
      : '<p class="muted">No screenshot of this step (the page was gone or changing, or the test’s <code>maxStepScreenshots</code> was used up).</p>') +
    '<ol class="steplist">' + walk.steps.map((s, j) => '<li><button data-k="' + j + '"' + (j === k ? ' aria-current="true"' : '') + ' title="' + esc(stepText(s)) + '"><span class="n">' + (j + 1) + '</span>' + esc(stepText(s)) + '</button></li>').join('') + '</ol>';
  const w = $('#main .walk');
  w.querySelectorAll('[data-walk-step]').forEach(b => b.onclick = () => showStep(a, stepAt + +b.dataset.walkStep));
  w.querySelectorAll('.seg button[data-view]').forEach(b => b.onclick = () => { stepView = b.dataset.view; showStep(a, stepAt); });
  w.querySelectorAll('.steplist button[data-k]').forEach(b => b.onclick = () => showStep(a, +b.dataset.k));
  if (shot) wireShot(w.querySelector('.shot'), shotRoute, shot, boxInfo(shotRoute), () => {
    if (st.key == null) return;
    // The instance acted on when it's known (the "Delete" of that row), else every box of the element.
    const at = view === 'before' ? st.beforeBox : st.afterBox;
    const one = at != null && w.querySelector('.box[data-i="' + at + '"][data-key="' + CSS.escape(st.key) + '"]');
    (one ? [one] : w.querySelectorAll('.box[data-key="' + CSS.escape(st.key) + '"]')).forEach(b => b.classList.add('target'));
  });
  wireGoto(w);
  // Preload the neighbours' screenshots.
  [k - 1, k + 1].forEach(j => { const s = walk.steps[j]; if (s) [s.before, s.after].forEach(x => { if (has(x)) new Image().src = walk.states[x].source; }); });
  setTestHash(a, k);
}

// '#<route>' or '#<route>&state=<n>' (route names are encoded, so '&' only separates).
const hashParts = () => { const [route, query] = location.hash.split('&'); const m = /^state=(\\d+)$/.exec(query || ''); return { route, state: m ? +m[1] - 1 : undefined }; };
const indexOfHash = () => data.routes.findIndex(r => '#' + encodeURIComponent(r.route) === hashParts().route);
const untestedOfHash = () => untestedViews.findIndex(v => UNTESTED_HASH + encodeURIComponent(v.view) === location.hash);
addEventListener('hashchange', () => {
  if (location.hash.startsWith(TEST_HASH)) {
    const { a, step } = testOfHash();
    if (a < 0) return;
    if (a !== currentTest) showTest(a, step);
    else if (step !== undefined && step !== stepAt && walking()) showStep(a, step);
    return;
  }
  if (location.hash === REPEATED_HASH) { if (current !== -1) showRepeated(); return; }
  if (location.hash.startsWith(UNTESTED_HASH)) { const u = untestedOfHash(); if (u >= 0 && u !== currentUntested) showUntested(u); return; }
  const i = indexOfHash();
  const { state } = hashParts();
  if (i >= 0 && i !== current) show(i, false, undefined, state);
  else if (i >= 0 && state !== undefined && state !== stateAt) {
    if (stepping()) showState(i, state, boxInfo(data.routes[i])); else show(i, false, undefined, state);
  }
});
const fromHash = indexOfHash();
const first = firstVisible();
if (location.hash.startsWith(TEST_HASH) && testOfHash().a >= 0) showTest(testOfHash().a, testOfHash().step);
else if (location.hash === REPEATED_HASH) showRepeated();
else if (untestedOfHash() >= 0) showUntested(untestedOfHash());
else show(fromHash >= 0 ? fromHash : first ? +first.dataset.i : 0, false, undefined, fromHash >= 0 ? hashParts().state : undefined);
</script>
</body>
</html>
`;
}
