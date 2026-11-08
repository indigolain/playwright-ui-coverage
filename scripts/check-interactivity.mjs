// In-browser check of the interactivity rules and interaction types
// (src/tracker.ts). Runs the built tracker (dist/) in Chromium against a
// fixture page and compares the inventory and the recorded interactions
// (keys computed from the raw recording with dist/model/resolve.js).
//
//   npm run check:interactivity    # builds first
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const { tracker } = require('../dist/tracker.js');
const { Resolver, compileRules } = require('../dist/model/resolve.js');
const { RECORDED_CANDIDATES } = require('../dist/model/elements.js');

/** Keys of raw element refs, with default identity rules. */
const keysOf = (nodes, refs) => {
  const r = new Resolver({ nodes }, compileRules({}));
  return refs.map((ref) => r.key(r.node(ref)));
};
const { interactionArgs, DEFAULT_INTERACTIONS } = require('../dist/interactions.js');

const PAGE = `<!doctype html><html><body>
  <a id="link" href="/x">Link</a>
  <a id="mailto" href="mailto:a@b.c">Mail</a>
  <a id="tel" href=" TEL:+1555">Tel</a>
  <a id="sms" href="sms:+1555">SMS</a>
  <a id="nohref">No href</a>
  <button id="btn">Button</button>
  <input id="hidden" type="hidden">
  <input id="text">
  <select id="sel"><option id="opt">A</option></select>
  <textarea id="ta"></textarea>
  <details><summary id="sum">More</summary>x</details>
  <video id="video" controls width="40" height="20"></video>
  <video id="video-nocontrols" width="40" height="20"></video>
  <iframe id="frame" width="40" height="20"></iframe>
  <div id="editor" contenteditable="true">Edit <a id="in-editor" href="/y">inner</a></div>
  <div id="role-button" role="button">Role</div>
  <div id="role-tablist" role="tablist"><div id="tab" role="tab">Tab</div></div>
  <div id="tabindex0" tabindex="0">Card</div>
  <div id="tabindex-1" tabindex="-1">Not in tab order</div>
  <span id="drag" draggable="true">Drag</span>
  <label id="label" for="text">Label</label>
  <label id="wrap-label"><input id="cb" type="checkbox"> Wrapped</label>

  <div id="outer-one" role="button" tabindex="0">Outer <input id="inner-one" type="checkbox"></div>
  <div id="outer-many" tabindex="0">Card <button id="inner-a">A</button><button id="inner-b">B</button></div>
  <div id="tree" role="tree">
    <div id="parent-item" role="treeitem">Parent
      <div role="group"><div id="child-item" role="treeitem">Child</div></div>
    </div>
  </div>
  <div id="forced-outer" tabindex="0" data-uicov-interactive="include">Forced <button id="forced-inner">In</button></div>

  <div id="include" data-uicov-interactive="include">Plain div</div>
  <button id="exclude" data-uicov-interactive="exclude">Excluded</button>
  <div id="exclude-parent" role="button" data-uicov-interactive="exclude"><button id="under-exclude">Still counts</button></div>
  <section data-uicov-interactive="exclude-all">
    <button id="excluded-all">Gone</button>
    <div data-uicov-interactive="reset"><button id="reset">Back</button></div>
    <div id="inc-in-excluded" data-uicov-interactive="include">Forced in excluded</div>
  </section>
  <footer data-uicov-ignore><button id="ignored">Ignored</button></footer>
  <aside class="banner"><button id="ignored-selector">Banner</button></aside>

  <div id="scroller" style="height:40px;overflow:auto"><div style="height:400px">tall</div></div>
  <div id="no-overflow" style="height:40px;overflow:auto">short</div>
  <span id="dbl-only" tabindex="0">Rename</span>
</body></html>`;

const EXPECTED_INVENTORY = [
  'link', 'btn', 'text', 'sel', 'ta', 'sum', 'video', 'editor', 'role-button', 'tab', 'tabindex0',
  'drag', 'cb', 'inner-one', 'inner-a', 'inner-b', 'parent-item', 'child-item', 'forced-outer',
  'forced-inner', 'include', 'under-exclude', 'reset', 'inc-in-excluded', 'scroller', 'dbl-only',
];

const options = {
  ignoreSelectors: ['.banner', '!!invalid'],
  extraCandidates: RECORDED_CANDIDATES.join(','),
  // scroll is opt-in; turn it on so scroll containers are inventoried and credited.
  ...interactionArgs({
    interactions: [...DEFAULT_INTERACTIONS, 'scroll'],
    allowedInteractions: [{ selector: '#dbl-only', events: ['dblclick'] }],
  }),
};

const browser = await chromium.launch();
let failures = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${e.message.split('\n').join('\n       ')}`);
  }
};

async function setup(opts = options) {
  const context = await browser.newContext();
  const recorded = [];
  await context.exposeBinding(
    '__uicovRecord',
    (_source, i) => void recorded.push(`${i.event}:${keysOf(i.nodes, [i.element])[0]}`),
  );
  await context.addInitScript(tracker, opts);
  const page = await context.newPage();
  page.on('console', () => {}); // invalid selector warning
  await page.route('http://uicov.test/', (route) => route.fulfill({ contentType: 'text/html', body: PAGE }));
  await page.goto('http://uicov.test/');
  const take = async () => {
    await page.waitForTimeout(50);
    return recorded.splice(0);
  };
  return { context, page, take };
}

try {
  const { context, page, take } = await setup();
  const inventory = async () => {
    const inv = await page.evaluate(() => window.__uicovInventory());
    return keysOf(inv.nodes, inv.elements.filter((e) => !e.candidateOnly)).map((k) => k.replace(/^#/, ''));
  };

  console.log('interactivity rules');
  await check('inventory', async () => assert.deepEqual(await inventory(), EXPECTED_INVENTORY));

  console.log('interaction types');
  await check('click on a role=button', async () => {
    await page.click('#role-button');
    assert.deepEqual(await take(), ['click:#role-button']);
  });
  await check('click on a container with one widget credits that widget', async () => {
    await page.click('#outer-one', { position: { x: 2, y: 2 } });
    assert.deepEqual(await take(), ['click:#inner-one']);
  });
  await check('click on a container with several widgets credits nothing', async () => {
    await page.click('#outer-many', { position: { x: 2, y: 2 } });
    assert.deepEqual(await take(), []);
  });
  await check('click on an excluded button credits nothing', async () => {
    await page.click('#exclude');
    await page.click('#excluded-all');
    await page.click('#ignored');
    await page.click('#ignored-selector');
    assert.deepEqual(await take(), []);
  });
  await check('click on a label credits the control once (forwarded by the browser)', async () => {
    await page.click('#label');
    assert.deepEqual(await take(), ['click:#text']);
  });
  await check('dblclick and contextmenu on a label credit the control', async () => {
    await page.dblclick('#label');
    await page.click('#label', { button: 'right' });
    const got = await take();
    assert.ok(got.includes('dblclick:#text') && got.includes('contextmenu:#text'), got.join(', '));
  });
  await check('mailto link is not credited', async () => {
    await page.click('#mailto', { noWaitAfter: true }).catch(() => {});
    assert.deepEqual(await take(), []);
  });
  await check('allowedInteractions: only dblclick counts', async () => {
    await page.click('#dbl-only');
    await page.focus('#dbl-only');
    await page.keyboard.press('Enter');
    assert.deepEqual(await take(), []);
    await page.dblclick('#dbl-only');
    assert.deepEqual(await take(), ['dblclick:#dbl-only']);
  });
  await check('keyboard activation: Enter/Space on a focused element, not typing', async () => {
    await page.focus('#tabindex0');
    await page.keyboard.press('Enter');
    await page.keyboard.press('a');
    await page.focus('#text');
    await page.keyboard.press('Space');
    assert.deepEqual(await take(), ['keydown:#tabindex0', 'input:#text']);
  });
  await check('scroll credits the container once per gesture', async () => {
    await page.hover('#scroller');
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 20);
    await page.waitForTimeout(100);
    assert.deepEqual(await take(), ['scroll:#scroller']);
    await page.waitForTimeout(600);
    await page.mouse.wheel(0, 20);
    assert.deepEqual(await take(), ['scroll:#scroller']);
  });
  await check('drag and drop credits source and target', async () => {
    await page.evaluate(() => {
      const t = document.getElementById('include');
      t.addEventListener('dragover', (e) => e.preventDefault());
      t.addEventListener('drop', (e) => e.preventDefault());
    });
    await page.dragAndDrop('#drag', '#include');
    const got = await take();
    assert.ok(got.includes('dragstart:#drag') && got.includes('drop:#include'), got.join(', '));
  });
  await check('focus is off by default', async () => {
    await page.focus('#btn');
    await page.focus('#ta');
    assert.deepEqual(await take(), []);
  });
  await check('file selection counts as change/input', async () => {
    await page.evaluate(() => {
      const f = document.createElement('input');
      f.type = 'file';
      f.id = 'file';
      document.body.append(f);
    });
    await page.setInputFiles('#file', { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('a') });
    const got = await take();
    assert.ok(got.includes('change:#file'), got.join(', '));
  });
  await context.close();

  await check('interactions option: focus/blur opt-in, scroll off', async () => {
    const s = await setup({ ...options, ...interactionArgs({ interactions: ['click', 'focus', 'blur'] }) });
    await s.page.focus('#btn');
    await s.page.focus('#ta');
    assert.deepEqual(await s.take(), ['focus:#btn', 'blur:#btn', 'focus:#ta']);
    const inv = await s.page.evaluate(() => window.__uicovInventory());
    const keys = keysOf(inv.nodes, inv.elements.filter((e) => !e.candidateOnly));
    assert.ok(!keys.includes('#scroller'), 'scroll container inventoried although scroll is off');
    await s.context.close();
  });
} finally {
  await browser.close();
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else console.log('\nAll interactivity checks passed.');
