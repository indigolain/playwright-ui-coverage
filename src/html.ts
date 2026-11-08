import type { CoverageSummary, ElementCoverage } from './aggregate';
import { mostRepeated } from './insights';
import { testSkeleton } from './locators';

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Shrinks the embedded data: screenshot boxes become `[elementIndex, x, y, w, h]`
 * (instead of repeating each element key per box) with coordinates rounded to
 * 0.1 px. coverage.json keeps the full format.
 */
function compact(summary: CoverageSummary) {
  const tests = summary.tests ?? [];
  const testIndex = new Map(tests.map((t, i) => [t.id, i]));
  return {
    ...summary,
    tests,
    mostRepeated: summary.mostRepeated ?? mostRepeated(summary),
    routes: summary.routes.map((r) => {
      const index = new Map(r.elements.map((e, i) => [e.key, i]));
      return {
        ...r,
        // The page needs neither the raw recorded data nor locators for tested elements.
        // Hints become their messages.
        elements: r.elements.map(({ role, name, nameFrom, attrs, suggestedLocator, a11yHints, ...e }) => ({
          ...compactTestIds(e, testIndex),
          ...(e.tested || !suggestedLocator ? {} : { suggestedLocator }),
          ...(a11yHints?.length ? { a11yHints: a11yHints.map((h) => h.message) } : {}),
        })),
        screenshots: r.screenshots.map(({ testId: _, ...s }) => ({
          ...s,
          boxes: s.boxes.map((b) => {
            const i = index.get(b.key);
            return i === undefined ? b : [i, round1(b.x), round1(b.y), round1(b.w), round1(b.h)];
          }),
        })),
      };
    }),
  };
}

/**
 * Test ids become `ti` / `tf`: indexes into `tests` (which is sorted by title),
 * so "Tested by" lists them in title order.
 */
function compactTestIds(e: ElementCoverage, testIndex: Map<string, number>) {
  const { testIds, failingTestIds, ...rest } = e;
  if (!testIds) return rest;
  const idx = (ids: string[] = []) =>
    ids.map((id) => testIndex.get(id)).filter((i): i is number => i !== undefined).sort((a, b) => a - b);
  return { ...rest, ti: idx(testIds), tf: idx(failingTestIds) };
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
  td:last-child::before { content: 'Tested by: '; }
}
tr.flash td { animation: flash 1.2s ease-out; }
@keyframes flash { from { background: rgba(245,158,11,.3); } to { background: transparent; } }
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
      <input type="search" id="search" placeholder="Filter routes" title="Filter routes (press /)" aria-label="Filter routes" autocomplete="off" spellcheck="false">
      <div class="row">
        <span class="muted" id="navCount"></span>
        <label class="muted">Sort <select id="sort" aria-label="Sort routes">
          <option value="name">Name</option>
          <option value="coverage">Lowest coverage</option>
          <option value="untested">Most untested</option>
        </select></label>
      </div>
    </div>
    <button id="insightsNav" aria-current="false"><div class="row"><span>Most repeated elements</span><span class="muted" id="insightsCount"></span></div>
      <div class="sub muted" id="insightsSub"></div></button>
    <div id="navList"></div>
    <p class="muted" id="navEmpty" hidden>No routes match.</p>
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
$('#totalDetail').textContent = data.tested + ' of ' + data.total + ' interactive elements tested across ' + data.routes.length + ' routes' +
  (data.failingOnly ? ' (' + data.failingOnly + ' touched only by failing tests)' : '') +
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
    '<div class="sub muted">' + (untested ? untested + ' untested' : 'all tested') + ' · ' + r.total + ' elements' +
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
sortSel.onchange = () => { store.set('sort', sortSel.value); applySort(); };
search.oninput = applyFilter;
search.onkeydown = e => {
  if (e.key === 'Enter') { const b = firstVisible(); if (b) show(+b.dataset.i, true); }
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
  for (const raw of s.boxes) {
    const b = Array.isArray(raw) ? { key: r.elements[raw[0]].key, x: raw[1], y: raw[2], w: raw[3], h: raw[4] } : raw;
    // The screenshot may be cropped (maxScreenshotHeight): drop or clip boxes outside it.
    if (b.y >= cssH || b.x >= cssW) continue;
    const w = Math.min(b.w, cssW - b.x);
    const h = Math.min(b.h, cssH - b.y);
    const info = tested.get(b.key);
    const d = document.createElement('div');
    d.className = 'box' + (info && info.tested ? ' ok' : info && failingOnly(info) ? ' warn' : '');
    d.dataset.key = b.key;
    d.title = (info ? info.label : b.key) + (info && info.tested ? ' — tested' : info && failingOnly(info) ? ' — failing tests only' : ' — untested') +
      (info && info.suggestedLocator ? '\\n' + info.suggestedLocator + '\\n(click to show it in the table)' : '');
    d.style.cssText = 'left:' + (b.x / cssW * 100) + '%;top:' + (b.y / cssH * 100) + '%;width:' + (w / cssW * 100) + '%;height:' + (h / cssH * 100) + '%';
    frag.appendChild(d);
  }
  el.appendChild(frag);
  el.classList.add('loaded');
}

function show(i, fromUser, focusKey) {
  const r = data.routes[i];
  if (!r) { $('#main').innerHTML = '<p class="muted">No coverage data.</p>'; return; }
  try { history.replaceState(null, '', '#' + encodeURIComponent(r.route)); } catch {}
  insightsNav.setAttribute('aria-current', 'false');
  if (buttons[current]) buttons[current].setAttribute('aria-current', 'false');
  current = i;
  buttons[i].setAttribute('aria-current', 'true');
  if (!fromUser) buttons[i].scrollIntoView({ block: 'nearest' });

  const tested = new Map(r.elements.map(e => [e.key, e]));
  const shots = r.screenshots.map((s, si) =>
    '<figure><div class="shot" data-si="' + si + '"><img loading="lazy" decoding="async" src="' + esc(s.source) + '" alt="Screenshot of ' + esc(r.route) + '"></div>' +
    '<figcaption>from: ' + esc(s.test) + '</figcaption></figure>').join('');
  const rows = sortedElements(r.elements).map(e =>
    '<tr class="' + (e.tested ? 'ok' : 'bad') + '" data-key="' + esc(e.key) + '">' +
      '<td><span class="pill ' + (e.tested ? 'ok" title="' + esc(countsText(e)) + '">tested' : failingOnly(e) ? 'warn" title="Touched only by tests that did not pass; not counted as tested">failing tests only' : 'bad">untested') + '</span></td>' +
      '<td>' + esc(e.label) + (e.instances > 1 ? ' <span class="muted">×' + e.instances + '</span>' : '') + (e.key !== e.label ? '<br><code class="muted">' + esc(e.key) + '</code>' : '') +
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
    '<span class="muted">' + r.tested + '/' + r.total + ' tested (' + r.percent + '%)</span>' +
    (r.a11yHints ? '<span class="a11y-count" title="Informational; not part of the coverage score">' + plural(r.a11yHints, 'accessibility hint') + '</span>' : '') +
    '<span style="margin-left:auto"></span>' +
    (r.elements.some(e => !e.tested && e.suggestedLocator) ? '<button class="btn" data-copy="skeleton" title="A test that visits this route and touches each untested element">Copy untested as test skeleton</button>' : '') +
    '<label><input type="checkbox" id="only"' + (onlyUntested ? ' checked' : '') + '> Untested only</label></div>' +
    (shots ? '<div class="shots">' + shots + '</div>' : '') +
    '<div class="table-wrap"><table><thead><tr><th>Status</th><th>Element</th>' + insightHeaders() + '<th>Tested by</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  main.querySelectorAll('th[data-sort] button').forEach(b => b.onclick = () => setRowSort(r, b.parentNode.dataset.sort));

  $('#only').onchange = (e) => {
    onlyUntested = e.target.checked;
    store.set('onlyUntested', onlyUntested ? '1' : '0');
    main.className = onlyUntested ? 'only-untested' : '';
  };

  // Overlay boxes are placed only once each (lazy) image has loaded.
  main.querySelectorAll('.shot').forEach(el => {
    const s = r.screenshots[+el.dataset.si];
    const img = el.querySelector('img');
    const place = () => placeBoxes(el, r, s, tested);
    if (img.complete && img.naturalWidth) place();
    else {
      img.addEventListener('load', place, { once: true });
      img.addEventListener('error', () => el.classList.add('loaded', 'missing'), { once: true });
    }
  });

  const focusRow = focusKey != null && main.querySelector('tr[data-key="' + CSS.escape(focusKey) + '"]');
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
  const tbody = main.querySelector('tbody');
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
  return e.ti.map(i => testItem(tests[i], false)).concat((e.tf || []).map(i => testItem(tests[i], true))).join('<br>') || '—';
}

// "Most repeated": elements used by the most tests, often setup steps such as signing in.
const repeated = data.mostRepeated || [];
const routeIndex = new Map(data.routes.map((r, i) => [r.route, i]));
const insightsNav = $('#insightsNav');
$('#insightsCount').textContent = String(repeated.length);
$('#insightsSub').textContent = repeated.length ? 'Up to ' + repeated[0].tests + ' tests per element' : 'None used by several tests';
const REPEATED_HASH = '#/insights/repeated';
function showRepeated() {
  try { history.replaceState(null, '', REPEATED_HASH); } catch {}
  if (buttons[current]) buttons[current].setAttribute('aria-current', 'false');
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
  main.querySelectorAll('a.goto').forEach(a => a.onclick = (ev) => {
    const i = routeIndex.get(a.dataset.route);
    if (i === undefined) return;
    ev.preventDefault();
    show(i, true, a.dataset.key);
  });
}
insightsNav.onclick = showRepeated;

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
  const btn = e.target.closest('button[data-copy]');
  if (btn) {
    const r = data.routes[current];
    const untested = r.elements.filter(x => !x.tested && x.suggestedLocator);
    const text = btn.dataset.copy === 'skeleton'
      ? testSkeleton(r.route, untested.map(x => x.suggestedLocator))
      : r.elements.find(x => x.key === btn.dataset.copy).suggestedLocator;
    copyText(text, btn);
    return;
  }
  // Clicking a box on a screenshot scrolls to its row (where the copy button is).
  const box = e.target.closest('.box');
  if (box) {
    const row = $('#main').querySelector('tr[data-key="' + CSS.escape(box.dataset.key) + '"]');
    if (row) {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      row.classList.remove('flash');
      void row.offsetWidth;
      row.classList.add('flash');
    }
  }
});

const indexOfHash = () => data.routes.findIndex(r => '#' + encodeURIComponent(r.route) === location.hash);
addEventListener('hashchange', () => {
  if (location.hash === REPEATED_HASH) { if (current !== -1) showRepeated(); return; }
  const i = indexOfHash(); if (i >= 0 && i !== current) show(i);
});
const fromHash = indexOfHash();
const first = firstVisible();
if (location.hash === REPEATED_HASH) showRepeated();
else show(fromHash >= 0 ? fromHash : first ? +first.dataset.i : 0);
</script>
</body>
</html>
`;
}
