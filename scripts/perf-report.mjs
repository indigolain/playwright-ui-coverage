// Builds a large synthetic report and measures it in a real browser.
//
//   npm run build && node scripts/perf-report.mjs [routes=300] [elements=80]
//
// Writes perf-report/ (index.html + a few screenshots) and prints timings for
// first render, route switching, search, sorting and hover highlighting.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { renderHtml } = createRequire(import.meta.url)(path.join(root, 'dist', 'html.js'));
const ROUTES = Number(process.argv[2] || 300);
const ELEMENTS = Number(process.argv[3] || 80);
const out = path.join(root, 'perf-report');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'screens'), { recursive: true });

// Deterministic pseudo-random numbers.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

const browser = await chromium.launch();

// A few real images (1280 x 2400 CSS px, dpr 1) shared by all routes.
const SHOTS = 6;
const SHOT_H = 2400;
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  for (let s = 0; s < SHOTS; s++) {
    await page.setContent(
      `<body style="margin:0;height:${SHOT_H}px;background:linear-gradient(hsl(${s * 60},40%,92%),hsl(${s * 60 + 30},40%,80%));font:24px system-ui">` +
        Array.from({ length: 40 }, (_, i) => `<div style="padding:18px 40px">Synthetic row ${i}</div>`).join('') +
        '</body>',
    );
    await page.screenshot({ path: path.join(out, 'screens', `${s}.jpg`), fullPage: true, type: 'jpeg', quality: 70 });
  }
  await page.close();
}

const segs = ['users', 'orders', 'settings', 'billing', 'reports', 'admin', 'projects', 'teams', 'inbox', 'search'];
const routes = [];
let total = 0;
let testedTotal = 0;
for (let r = 0; r < ROUTES; r++) {
  const route = `/${segs[r % segs.length]}/${Math.floor(r / segs.length)}/${['view', 'edit', 'list'][r % 3]}`;
  const cov = rand();
  const elements = [];
  for (let e = 0; e < ELEMENTS; e++) {
    const tested = rand() < cov;
    const label = `${['button', 'link', 'textbox', 'checkbox'][e % 4]} "Item ${e}"`;
    elements.push({
      key: e % 5 === 0 ? `testid=${route}-el-${e}` : label,
      label,
      tag: 'button',
      instances: e % 11 === 0 ? 3 : 1,
      tested,
      testedBy: tested ? [`spec ${e % 7} › does thing ${e % 13}`, `spec ${e % 3} › other ${e}`].slice(0, 1 + (e % 2)) : [],
    });
  }
  const tested = elements.filter((e) => e.tested).length;
  elements.sort((a, b) => Number(a.tested) - Number(b.tested) || a.label.localeCompare(b.label));
  const screenshots = [0, 1, 2].map((k) => ({
    source: `screens/${(r + k) % SHOTS}.jpg`,
    dpr: 1,
    test: `spec ${k} › visits ${route}`,
    // Some boxes fall below the image, as with a maxScreenshotHeight crop.
    boxes: elements.map((e, i) => ({ key: e.key, x: 40 + (i % 8) * 150, y: 30 + Math.floor(i / 8) * (SHOT_H / 9), w: 120, h: 36 })),
  }));
  total += elements.length;
  testedTotal += tested;
  routes.push({ route, total: elements.length, tested, percent: Math.round((tested / elements.length) * 1000) / 10, elements, screenshots });
}
routes.sort((a, b) => a.route.localeCompare(b.route));
const summary = {
  generatedAt: new Date().toISOString(),
  total,
  tested: testedTotal,
  percent: Math.round((testedTotal / total) * 1000) / 10,
  routes,
};
const html = renderHtml(summary);
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log(`${ROUTES} routes x ${ELEMENTS} elements, index.html ${(html.length / 1024 / 1024).toFixed(2)} MB`);

const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
const url = pathToFileURL(path.join(out, 'index.html')).href;
const t0 = Date.now();
await page.goto(url);
await page.locator('.box').first().waitFor();
const load = Date.now() - t0;
const nav = await page.evaluate(() => performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd);
console.log(`load (goto → first overlay boxes): ${load} ms, DOMContentLoaded ${nav.toFixed(0)} ms`);

// Each measurement: script time plus a forced style/layout pass (paint excluded).
const time = (fn, arg) =>
  page.evaluate(
    ([src, a]) => {
      const f = new Function('a', `return (${src})(a)`);
      const t = performance.now();
      f(a);
      void document.body.offsetHeight;
      return performance.now() - t;
    },
    [fn.toString(), arg],
  );
const stats = (xs) => {
  xs.sort((a, b) => a - b);
  return `median ${xs[Math.floor(xs.length / 2)].toFixed(1)} ms, max ${xs[xs.length - 1].toFixed(1)} ms`;
};

const sw = [];
for (let i = 0; i < 20; i++) sw.push(await time((n) => document.querySelectorAll('#navList button')[n].click(), (i * 37) % ROUTES));
console.log(`switch route: ${stats(sw)}`);

const typing = [];
for (const q of ['u', 'us', 'use', 'user', 'users/1', 'users/1/', '']) {
  typing.push(await time((v) => { const s = document.getElementById('search'); s.value = v; s.dispatchEvent(new Event('input')); }, q));
}
console.log(`search keystroke: ${stats(typing)}`);

const sorts = [];
for (const v of ['coverage', 'untested', 'name', 'coverage', 'untested', 'name']) {
  sorts.push(await time((val) => { const s = document.getElementById('sort'); s.value = val; s.dispatchEvent(new Event('change')); }, v));
}
console.log(`sort change: ${stats(sorts)}`);

const hov = [];
const rows = await page.locator('tbody tr').count();
for (let i = 0; i < 15; i++) {
  hov.push(await time((n) => document.querySelectorAll('tbody tr')[n].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })), (i * 7) % rows));
}
console.log(`hover highlight: ${stats(hov)}`);

const tog = [];
for (let i = 0; i < 6; i++) tog.push(await time(() => document.getElementById('only').click()));
console.log(`"Untested only" toggle: ${stats(tog)}`);

const dom = await page.evaluate(() => document.getElementsByTagName('*').length);
console.log(`DOM nodes: ${dom}`);
await browser.close();
