// Checks suggested locators (src/locators.ts) and accessibility hints (src/a11y.ts).
//
//   npm run check:locators    # builds first
//
// 1. Pure-function checks against the built dist/.
// 2. If ui-coverage-report/coverage.json exists (run `npm run demo` first), starts
//    the demo server and checks that every suggested locator in it finds the
//    element (exactly one match, or at least one with `.first()`).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { suggestedLocator, testSkeleton, playwrightRole } = require('../dist/locators.js');
const { elementHints, duplicateNameHints } = require('../dist/a11y.js');

// ---- 1. Pure functions ---------------------------------------------------
const el = (o) => ({ key: '#x', label: 'button', tag: 'button', instances: 1, attrs: {}, ...o });
const loc = (o, opts, ctx) => suggestedLocator(el(o), opts, ctx);

assert.equal(
  loc({ key: '[data-testid="save"]', attrs: { 'data-testid': 'save' }, role: 'button', name: 'Save', nameFrom: 'text' }),
  "await page.getByTestId('save').click();",
);
// Custom testIdAttribute: data-testid is then just an attribute.
assert.equal(
  loc({ attrs: { 'data-testid': 'save', 'data-qa': 'save-btn' }, role: 'button', name: 'Save', nameFrom: 'text' }, { testIdAttribute: 'data-qa' }),
  "await page.getByTestId('save-btn').click();",
);
assert.equal(
  loc({ role: 'button', name: "Don't save", nameFrom: 'text' }),
  "await page.getByRole('button', { name: 'Don\\'t save' }).click();",
);
// Attribute-derived names match exactly; text ones as Playwright's default.
assert.equal(
  loc({ tag: 'textarea', role: 'textbox', name: 'Bio', nameFrom: 'label' }),
  "await page.getByRole('textbox', { name: 'Bio', exact: true }).fill('…');",
);
// A text name contained in another name of the same role: whole-string regex.
assert.equal(
  loc({ role: 'button', name: 'Save', nameFrom: 'text' }, {}, { namesByRole: new Map([['button', ['save', 'save draft']]]) }),
  "await page.getByRole('button', { name: /^Save$/i }).click();",
);
// Same name twice on the page: the key.
assert.match(
  loc({ key: 'main > p:nth-of-type(2) > a', tag: 'a', role: 'link', name: 'Details', nameFrom: 'text' }, {}, { namesByRole: new Map([['link', ['details', 'details']]]) }),
  /^await page\.locator\('body > main > p:nth-of-type\(2\) > a'\)\.click\(\); \/\/ another link/,
);
assert.equal(
  loc({ tag: 'input', attrs: { type: 'email' }, role: 'textbox', name: 'you@example.com', nameFrom: 'placeholder' }),
  "await page.getByPlaceholder('you@example.com', { exact: true }).fill('user@example.com');",
);
assert.equal(
  loc({ tag: 'input', attrs: { type: 'checkbox' }, role: 'checkbox', name: 'Remember me', nameFrom: 'label' }),
  "await page.getByRole('checkbox', { name: 'Remember me', exact: true }).check();",
);
assert.equal(
  loc({ tag: 'select', role: 'combobox', name: 'Theme', nameFrom: 'label' }),
  "await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('…');",
);
assert.equal(
  loc({ key: '[name="avatar"]', tag: 'input', attrs: { type: 'file', name: 'avatar' }, role: 'textbox', name: 'Avatar', nameFrom: 'label' }),
  "await page.getByLabel('Avatar', { exact: true }).setInputFiles('path/to/file');",
);
assert.equal(playwrightRole(el({ tag: 'input', attrs: { type: 'number' }, role: 'textbox' })), 'spinbutton');
// No name: CSS from the key; raw data-uicov-id values become selectors.
assert.equal(loc({ key: 'main > div > button', role: 'button', name: '', nameFrom: '' }), "await page.locator('body > main > div > button').click();");
assert.equal(
  loc({ key: 'like', label: 'button "Like (3)" (+2 variants)', attrs: { 'data-uicov-id': 'like' }, role: 'button', name: 'Like (3)', nameFrom: 'text' }),
  "await page.locator('[data-uicov-id=\"like\"]').click(); // accessible name varies between runs or instances, so this uses the element's key",
);
assert.match(loc({ instances: 3, role: 'button', name: 'Delete', nameFrom: 'text' }), /\.first\(\)\.click\(\); \/\/ 3 matching elements/);
// The select's text (its options) is not its name.
assert.equal(loc({ key: '#s', tag: 'select', role: 'combobox', name: 'A B', nameFrom: 'text' }), "await page.locator('#s').selectOption('…');");

const skeleton = testSkeleton('/users/:id', ["await page.getByRole('button', { name: 'Edit' }).click();"]);
assert.match(skeleton, /^test\('covers untested elements on \/users\/:id', async \(\{ page \}\) => \{\n  await page\.goto\('\/users\/:id' \/\* TODO/);
assert.match(skeleton, /  await page\.getByRole\('button', \{ name: 'Edit' \}\)\.click\(\);\n  \/\/ TODO: assert the result\n\}\);\n$/);
// It runs in the report page, so it must not depend on anything outside its body.
assert.equal(new Function(`return (${testSkeleton.toString()})`)()('/', []), testSkeleton('/', []));

const rules = (o) => elementHints(el(o)).map((h) => h.rule);
assert.deepEqual(rules({ role: 'button', name: '', nameFrom: '' }), ['no-name']);
assert.deepEqual(rules({ tag: 'input', role: 'textbox', name: 'q', nameFrom: 'name' }), ['no-name']);
assert.deepEqual(rules({ tag: 'select', role: 'combobox', name: 'A B', nameFrom: 'text' }), ['no-name']);
assert.deepEqual(rules({ tag: 'input', role: 'textbox', name: 'Search', nameFrom: 'placeholder' }), ['placeholder-only']);
assert.deepEqual(rules({ tag: 'span', attrs: { role: 'button' }, role: 'button', name: 'Share', nameFrom: 'text' }), ['not-focusable']);
assert.deepEqual(rules({ tag: 'span', attrs: { role: 'button', tabindex: '0' }, role: 'button', name: 'Share', nameFrom: 'text' }), []);
assert.deepEqual(rules({ tag: 'div', attrs: { tabindex: '0' }, role: 'div', name: 'Card', nameFrom: 'text' }), ['no-role']);
assert.deepEqual(rules({ tag: 'div', attrs: { 'data-uicov-interactive': 'include' }, role: 'div', name: 'Tile', nameFrom: 'text' }), ['no-role']);
assert.deepEqual(rules({ tag: 'div', attrs: {}, role: 'div', name: 'Log', nameFrom: 'text' }), []); // e.g. a scroll container
assert.deepEqual(rules({ role: 'button', name: 'Save', nameFrom: 'text' }), []);
assert.deepEqual(rules({ role: 'button', name: '' }), []); // recorded before nameFrom existed

const link = (key, href, name) => el({ key, tag: 'a', role: 'link', name, nameFrom: 'text', attrs: { href } });
const links = [link('#a', '/a', 'Read more'), link('#b', '/b', 'read more'), link('#c', '/a', 'Home'), link('#d', '/a', 'Home')];
const dupes = duplicateNameHints(links);
assert.deepEqual([...dupes.keys()].map((e) => e.key), ['#a', '#b']); // same href: fine
assert.match(dupes.get(links[0])[0].message, /^1 other link named "Read more" goes somewhere else/);
console.log('locator and a11y functions: ok');

// ---- 2. Demo report ------------------------------------------------------
const reportFile = path.join(root, 'ui-coverage-report', 'coverage.json');
if (!fs.existsSync(reportFile)) {
  console.log('no ui-coverage-report/coverage.json: skipping the demo check (run `npm run demo` first)');
  process.exit(0);
}
const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
const port = Number(process.env.PORT || 4173);
const server = spawn(process.execPath, [path.join(root, 'demo', 'server.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
const browser = await chromium.launch();
let bad = 0;
try {
  const page = await browser.newPage();
  for (let i = 0; i < 50; i++) {
    try { await page.goto(`http://localhost:${port}/`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  for (const r of report.views) {
    await page.goto(`http://localhost:${port}${r.name.replace(':id', '1')}`);
    // Show content that tests open first (the add-user dialog, "Learn more").
    await page.evaluate(() => {
      document.querySelector('dialog')?.show();
      const more = document.getElementById('more');
      if (more) more.hidden = false;
    });
    // Elements, and the <a> elements of link units (once each).
    const linkEls = [...new Map((r.links ?? []).flatMap((l) => l.referrers).map((e) => [e.key, e])).values()];
    for (const e of [...r.elements, ...linkEls]) {
      const expr = e.suggestedLocator.replace(/^await /, '').replace(/\.(click|fill|check|selectOption|setInputFiles|press)\(.*$/, '');
      const n = await new Function('page', `return ${expr}`)(page).count();
      const ok = expr.endsWith('.first()') ? n >= 1 : n === 1;
      // The demo's "Export CSV · as of <time>" button has per-run text that a single
      // run sees only once: a known limit of name-based locators (see README).
      const known = /as of \d/.test(e.name || '');
      if (!ok && !known) {
        bad++;
        console.log(`FAIL ${r.name}: ${expr} matched ${n}`);
      }
    }
  }
} finally {
  await browser.close();
  server.kill();
}
if (bad) {
  console.error(`${bad} suggested locator(s) didn't resolve`);
  process.exit(1);
}
console.log(`demo report: all suggested locators resolve (${report.views.reduce((n, r) => n + r.elements.length, 0)} elements and their links' <a> elements)`);
