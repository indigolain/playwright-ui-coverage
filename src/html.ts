import type { CoverageSummary } from './aggregate';

/** Renders a self-contained HTML report (screenshots are referenced from ./screens). */
export function renderHtml(summary: CoverageSummary): string {
  const data = JSON.stringify(summary).replace(/</g, '\\u003c');
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
.layout { display: grid; grid-template-columns: 280px 1fr; min-height: calc(100vh - 58px); }
@media (max-width: 760px) { .layout { grid-template-columns: 1fr; } nav { border-right: 0; border-bottom: 1px solid var(--border); } }
nav { border-right: 1px solid var(--border); background: var(--panel); padding: 8px; }
nav button { all: unset; display: block; width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 6px; cursor: pointer; }
nav button:hover { background: var(--bg); }
nav button[aria-current=true] { background: var(--bg); outline: 1px solid var(--border); }
.route { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; word-break: break-all; }
.bar { height: 4px; background: var(--bad-bg); border-radius: 2px; margin-top: 6px; overflow: hidden; }
.bar > i { display: block; height: 100%; background: var(--ok); }
.row { display: flex; justify-content: space-between; gap: 8px; }
main { padding: 20px; min-width: 0; }
.toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
.shots { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 720px), 1fr)); margin-bottom: 24px; }
figure { margin: 0; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
figcaption { padding: 6px 10px; font-size: 12px; color: var(--muted); border-top: 1px solid var(--border); }
.shot { position: relative; }
.shot img { display: block; width: 100%; height: auto; }
.box { position: absolute; border: 2px solid var(--bad); background: var(--bad-bg); border-radius: 3px; cursor: pointer; }
.box.ok { border-color: var(--ok); background: var(--ok-bg); }
.box.hl { outline: 3px solid var(--hl); outline-offset: 1px; z-index: 2; }
.only-untested .box.ok, .only-untested tr.ok { display: none; }
table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { font-size: 12px; color: var(--muted); font-weight: 600; }
tr.hl td { background: var(--bg); }
.pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.pill.ok { color: var(--ok); background: var(--ok-bg); }
.pill.bad { color: var(--bad); background: var(--bad-bg); }
.table-wrap { overflow-x: auto; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
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
  <nav id="nav" aria-label="Routes"></nav>
  <main id="main"></main>
</div>
<script id="data" type="application/json">${data}</script>
<script>
const data = JSON.parse(document.getElementById('data').textContent);
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

$('#total').textContent = data.percent + '%';
$('#totalDetail').textContent = data.tested + ' of ' + data.total + ' interactive elements tested across ' + data.routes.length + ' routes';
$('#generated').textContent = new Date(data.generatedAt).toLocaleString();

let onlyUntested = false;
try { onlyUntested = localStorage.getItem('uicov.onlyUntested') === '1'; } catch {}

function renderNav(current) {
  $('#nav').innerHTML = data.routes.map((r, i) =>
    '<button data-i="' + i + '" aria-current="' + (i === current) + '">' +
      '<div class="row"><span class="route">' + esc(r.route) + '</span><span>' + r.percent + '%</span></div>' +
      '<div class="bar"><i style="width:' + r.percent + '%"></i></div>' +
    '</button>').join('');
  $('#nav').querySelectorAll('button').forEach(b => b.onclick = () => show(+b.dataset.i));
}

function show(i) {
  const r = data.routes[i];
  if (!r) { $('#main').innerHTML = '<p class="muted">No coverage data.</p>'; return; }
  try { history.replaceState(null, '', '#' + encodeURIComponent(r.route)); } catch {}
  renderNav(i);
  const tested = new Map(r.elements.map(e => [e.key, e]));
  const shots = r.screenshots.map((s, si) =>
    '<figure><div class="shot" data-si="' + si + '"><img src="' + esc(s.source) + '" alt="Screenshot of ' + esc(r.route) + '"></div>' +
    '<figcaption>from: ' + esc(s.test) + '</figcaption></figure>').join('');
  const rows = r.elements.map(e =>
    '<tr class="' + (e.tested ? 'ok' : 'bad') + '" data-key="' + esc(e.key) + '">' +
      '<td><span class="pill ' + (e.tested ? 'ok">tested' : 'bad">untested') + '</span></td>' +
      '<td>' + esc(e.label) + (e.instances > 1 ? ' <span class="muted">×' + e.instances + '</span>' : '') + (e.key !== e.label ? '<br><code class="muted">' + esc(e.key) + '</code>' : '') + '</td>' +
      '<td class="muted">' + (e.testedBy.map(esc).join('<br>') || '—') + '</td>' +
    '</tr>').join('');
  $('#main').className = onlyUntested ? 'only-untested' : '';
  $('#main').innerHTML =
    '<div class="toolbar"><span class="route big">' + esc(r.route) + '</span>' +
    '<span class="muted">' + r.tested + '/' + r.total + ' tested (' + r.percent + '%)</span>' +
    '<label style="margin-left:auto"><input type="checkbox" id="only"' + (onlyUntested ? ' checked' : '') + '> Untested only</label></div>' +
    (shots ? '<div class="shots">' + shots + '</div>' : '') +
    '<div class="table-wrap"><table><thead><tr><th>Status</th><th>Element</th><th>Tested by</th></tr></thead><tbody>' + rows + '</tbody></table></div>';

  $('#only').onchange = (e) => {
    onlyUntested = e.target.checked;
    try { localStorage.setItem('uicov.onlyUntested', onlyUntested ? '1' : '0'); } catch {}
    $('#main').className = onlyUntested ? 'only-untested' : '';
  };

  $('#main').querySelectorAll('.shot').forEach(el => {
    const s = r.screenshots[+el.dataset.si];
    const img = el.querySelector('img');
    const place = () => {
      const cssW = img.naturalWidth / (s.dpr || 1);
      const cssH = img.naturalHeight / (s.dpr || 1);
      if (!cssW || !cssH) return;
      el.querySelectorAll('.box').forEach(b => b.remove());
      for (const b of s.boxes) {
        const info = tested.get(b.key);
        const d = document.createElement('div');
        d.className = 'box' + (info && info.tested ? ' ok' : '');
        d.dataset.key = b.key;
        d.title = (info ? info.label : b.key) + (info && info.tested ? ' — tested' : ' — untested');
        d.style.left = (b.x / cssW * 100) + '%';
        d.style.top = (b.y / cssH * 100) + '%';
        d.style.width = (b.w / cssW * 100) + '%';
        d.style.height = (b.h / cssH * 100) + '%';
        el.appendChild(d);
      }
    };
    img.complete ? place() : img.addEventListener('load', place);
  });
}

const highlight = (key, on) => {
  $('#main').querySelectorAll('[data-key]').forEach(n => {
    if (n.dataset.key === key) n.classList.toggle('hl', on);
  });
};
$('#main').addEventListener('mouseover', e => { const k = e.target.closest('[data-key]'); if (k) highlight(k.dataset.key, true); });
$('#main').addEventListener('mouseout', e => { const k = e.target.closest('[data-key]'); if (k) highlight(k.dataset.key, false); });

const fromHash = data.routes.findIndex(r => '#' + encodeURIComponent(r.route) === location.hash);
show(fromHash >= 0 ? fromHash : 0);
</script>
</body>
</html>
`;
}
