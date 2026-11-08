import type { CoverageSummary } from './aggregate';

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Shrinks the embedded data: screenshot boxes become `[elementIndex, x, y, w, h]`
 * (instead of repeating each element key per box) with coordinates rounded to
 * 0.1 px. coverage.json keeps the full format.
 */
function compact(summary: CoverageSummary) {
  return {
    ...summary,
    routes: summary.routes.map((r) => {
      const index = new Map(r.elements.map((e, i) => [e.key, i]));
      return {
        ...r,
        screenshots: r.screenshots.map((s) => ({
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
.pill { display: inline-block; white-space: nowrap; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.pill.ok { color: var(--ok); background: var(--ok-bg); }
.pill.bad { color: var(--bad); background: var(--bad-bg); }
.pill.warn { color: var(--hl); background: rgba(245,158,11,.18); }
.box.warn { border-color: var(--hl); background: rgba(245,158,11,.18); }
.warn-text { color: var(--hl); }
.table-wrap { overflow-x: auto; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
#navEmpty { padding: 8px 10px; }
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
    <div id="navList"></div>
    <p class="muted" id="navEmpty" hidden>No routes match.</p>
  </nav>
  <main id="main"></main>
</div>
<script id="data" type="application/json">${data}</script>
<script>
const data = JSON.parse(document.getElementById('data').textContent);
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem('uicov.' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('uicov.' + k, v); } catch {} },
};

$('#total').textContent = data.percent + '%';
$('#totalDetail').textContent = data.tested + ' of ' + data.total + ' interactive elements tested across ' + data.routes.length + ' routes' +
  (data.failingOnly ? ' (' + data.failingOnly + ' touched only by failing tests)' : '');
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
      (r.failingOnly ? ' · <span class="warn-text">' + r.failingOnly + ' failing only</span>' : '') + '</div>' +
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
    d.title = (info ? info.label : b.key) + (info && info.tested ? ' — tested' : info && failingOnly(info) ? ' — failing tests only' : ' — untested');
    d.style.cssText = 'left:' + (b.x / cssW * 100) + '%;top:' + (b.y / cssH * 100) + '%;width:' + (w / cssW * 100) + '%;height:' + (h / cssH * 100) + '%';
    frag.appendChild(d);
  }
  el.appendChild(frag);
  el.classList.add('loaded');
}

function show(i, fromUser) {
  const r = data.routes[i];
  if (!r) { $('#main').innerHTML = '<p class="muted">No coverage data.</p>'; return; }
  try { history.replaceState(null, '', '#' + encodeURIComponent(r.route)); } catch {}
  if (buttons[current]) buttons[current].setAttribute('aria-current', 'false');
  current = i;
  buttons[i].setAttribute('aria-current', 'true');
  if (!fromUser) buttons[i].scrollIntoView({ block: 'nearest' });

  const tested = new Map(r.elements.map(e => [e.key, e]));
  const shots = r.screenshots.map((s, si) =>
    '<figure><div class="shot" data-si="' + si + '"><img loading="lazy" decoding="async" src="' + esc(s.source) + '" alt="Screenshot of ' + esc(r.route) + '"></div>' +
    '<figcaption>from: ' + esc(s.test) + '</figcaption></figure>').join('');
  // "click ×3, input ×1", shown as the tooltip of the "tested" pill.
  const countsText = (e) => Object.entries(e.interactionCounts || {}).map(([t, n]) => t + ' ×' + n).join(', ');
  const rows = r.elements.map(e =>
    '<tr class="' + (e.tested ? 'ok' : 'bad') + '" data-key="' + esc(e.key) + '">' +
      '<td><span class="pill ' + (e.tested ? 'ok" title="' + esc(countsText(e)) + '">tested' : failingOnly(e) ? 'warn" title="Touched only by tests that did not pass; not counted as tested">failing tests only' : 'bad">untested') + '</span></td>' +
      '<td>' + esc(e.label) + (e.instances > 1 ? ' <span class="muted">×' + e.instances + '</span>' : '') + (e.key !== e.label ? '<br><code class="muted">' + esc(e.key) + '</code>' : '') + '</td>' +
      '<td class="muted">' + (e.testedBy.map(esc).concat((e.testedByFailing || []).map(t => esc(t) + ' (failed)')).join('<br>') || '—') + '</td>' +
    '</tr>').join('');
  const main = $('#main');
  litKey = null; lit = [];
  main.className = onlyUntested ? 'only-untested' : '';
  main.innerHTML =
    '<div class="toolbar"><span class="route big">' + esc(r.route) + '</span>' +
    '<span class="muted">' + r.tested + '/' + r.total + ' tested (' + r.percent + '%)</span>' +
    '<label style="margin-left:auto"><input type="checkbox" id="only"' + (onlyUntested ? ' checked' : '') + '> Untested only</label></div>' +
    (shots ? '<div class="shots">' + shots + '</div>' : '') +
    '<div class="table-wrap"><table><thead><tr><th>Status</th><th>Element</th><th>Tested by</th></tr></thead><tbody>' + rows + '</tbody></table></div>';

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

  if (fromUser) {
    const top = main.getBoundingClientRect().top;
    if (top < 0 || top > innerHeight * 0.6) main.scrollIntoView({ block: 'start' });
  }
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

const indexOfHash = () => data.routes.findIndex(r => '#' + encodeURIComponent(r.route) === location.hash);
addEventListener('hashchange', () => { const i = indexOfHash(); if (i >= 0 && i !== current) show(i); });
const fromHash = indexOfHash();
const first = firstVisible();
show(fromHash >= 0 ? fromHash : first ? +first.dataset.i : 0);
</script>
</body>
</html>
`;
}
