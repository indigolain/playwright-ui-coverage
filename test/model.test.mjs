// Unit tests for the node-side model (selector engine, identity, report-time
// rules). Self-contained; runs against the build:
//
//   npm run build && node --test test/model.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const { compileSelector, SelectorError } = require('../dist/model/selector.js');
const { resolveCoverageData } = require('../dist/model/resolve.js');
const { mergeRules, validateRules } = require('../dist/model/rules.js');

/** Builds a raw node table from a compact tree: [tag, attrs?, children?]. */
function table(tree) {
  const nodes = [];
  const byId = {};
  const add = ([tag, attrs, children = []], parent, nth, of) => {
    const node = { tag };
    if (parent !== undefined) node.parent = parent;
    if (of > 1) Object.assign(node, { nth, of });
    if (attrs && Object.keys(attrs).length) node.attrs = attrs;
    const idx = nodes.push(node) - 1;
    if (attrs?.['data-t']) byId[attrs['data-t']] = idx;
    const count = {};
    for (const c of children) count[c[0]] = (count[c[0]] ?? 0) + 1;
    const seen = {};
    for (const c of children) {
      seen[c[0]] = (seen[c[0]] ?? 0) + 1;
      add(c, idx, seen[c[0]], count[c[0]]);
    }
  };
  add(tree);
  return { nodes, byId };
}

/** SelectorNode objects (with parent links) for a table. */
function selectorNodes(nodes) {
  const out = [];
  for (const n of nodes) {
    const node = { tag: n.tag, attrs: n.attrs ?? {}, nth: n.nth ?? 1, of: n.of ?? 1 };
    if (n.parent !== undefined) node.parent = out[n.parent];
    out.push(node);
  }
  return out;
}

const PAGE = [
  'html',
  {},
  [
    [
      'body',
      { class: 'modal-open' },
      [
        ['nav', { 'data-t': 'nav' }, [['a', { href: '/', 'data-t': 'a1' }], ['a', { href: '/x', 'data-t': 'a2' }]]],
        [
          'main',
          {},
          [
            ['div', { class: 'cookie-banner big', 'data-t': 'banner' }, [['button', { 'data-t': 'ok' }]]],
            [
              'form',
              { id: 'login' },
              [
                ['input', { name: 'email', type: 'email', 'data-t': 'email' }],
                ['input', { name: 'plan', type: 'RADIO', value: 'pro', 'data-t': 'pro' }],
                ['button', { type: 'submit', 'data-t': 'submit' }],
              ],
            ],
            ['table', {}, [['tbody', { id: 'rows' }, [
              ['tr', {}, [['td', {}, [['button', { 'data-action': 'del', 'data-t': 'del1' }]]]]],
              ['tr', {}, [['td', {}, [['button', { 'data-action': 'del', 'data-t': 'del2' }]]]]],
            ]]]],
            ['section', { 'data-uicov-interactive': 'exclude-all' }, [
              ['button', { 'data-t': 'gone' }],
              ['div', { 'data-uicov-interactive': 'reset' }, [['button', { 'data-t': 'back' }]]],
            ]],
            ['div', { id: ':r1:' }, [['button', { 'data-t': 'gen' }]]],
          ],
        ],
      ],
    ],
  ],
];

describe('selector engine', () => {
  const { nodes, byId } = table(PAGE);
  const n = selectorNodes(nodes);
  const el = (t) => n[byId[t]];
  const m = (sel, t) => compileSelector(sel).matches(el(t));

  it('matches type, id, class and attributes', () => {
    assert.ok(m('button', 'ok'));
    assert.ok(m('.cookie-banner', 'banner'));
    assert.ok(m('.big.cookie-banner', 'banner'));
    assert.ok(!m('.cookie', 'banner'));
    assert.ok(m('form#login input[name=email]', 'email'));
    assert.ok(m('[href^="/"]', 'a2') && m('[href$=x]', 'a2') && m('[href*="x"]', 'a2'));
    assert.ok(m('[type=radio]', 'pro'), 'type is matched case-insensitively in HTML');
    assert.ok(!m('[name=EMAIL]', 'email') && m('[name=EMAIL i]', 'email'));
    assert.ok(m('[data-action|=del]', 'del1'));
  });

  it('handles combinators and lists', () => {
    assert.ok(m('nav a', 'a1'));
    assert.ok(m('nav > a', 'a1'));
    assert.ok(!m('main > button', 'ok'));
    assert.ok(m('main > div > button', 'ok'));
    assert.ok(m('body.modal-open main button', 'ok'));
    assert.ok(m('footer, .cookie-banner *', 'ok'));
    assert.ok(m(':root body nav a', 'a1'));
  });

  it('handles :not/:is and of-type pseudo-classes', () => {
    assert.ok(m('a:first-of-type', 'a1') && !m('a:first-of-type', 'a2'));
    assert.ok(m('a:last-of-type', 'a2') && m('a:nth-of-type(2)', 'a2') && m('a:nth-of-type(2n+1)', 'a1'));
    assert.ok(m('a:nth-last-of-type(1)', 'a2'));
    assert.ok(m('button:only-of-type', 'ok'));
    assert.ok(m('input:not([type=email])', 'pro') && !m('input:not([type=email])', 'email'));
    assert.ok(m(':is(nav, footer) a', 'a1'));
  });

  it('closest() also looks at ancestors', () => {
    assert.ok(compileSelector('.cookie-banner').closest(el('ok')));
    assert.ok(!compileSelector('.cookie-banner').closest(el('email')));
  });

  it('rejects what it cannot evaluate', () => {
    for (const s of ['a + b', 'a ~ b', 'a:has(b)', 'li:nth-child(2)', 'input:checked', 'a::before', '', 'a[', '[x="y]'])
      assert.throws(() => compileSelector(s), SelectorError, s);
  });
});

describe('resolveCoverageData', () => {
  const { nodes, byId } = table(PAGE);
  const box = { x: 0, y: 0, w: 10, h: 10 };
  const all = ['a1', 'a2', 'ok', 'email', 'pro', 'submit', 'del1', 'del2', 'back', 'gen'];
  const data = (extra = {}) => ({
    formatVersion: 2,
    nodes,
    snapshots: [
      {
        url: 'http://x/',
        dpr: 1,
        elements: [
          ...all.map((t) => ({ node: byId[t], name: t, ...box })),
          { node: byId.nav, ...box, candidateOnly: true },
        ],
      },
    ],
    interactions: [
      { event: 'click', url: 'http://x/', element: { node: byId.ok, name: 'OK' } },
      { event: 'click', url: 'http://x/', element: { node: byId.del2, name: 'Delete' } },
    ],
    ...extra,
  });
  const keys = (d) => d.snapshots[0].elements.map((e) => e.key);

  it('computes keys like the browser used to', () => {
    const out = resolveCoverageData(data());
    assert.deepEqual(keys(out), [
      'nav > a:nth-of-type(1)',
      'nav > a:nth-of-type(2)',
      'main > div:nth-of-type(1) > button',
      '[name="email"]',
      '[name="plan"][value="pro"]',
      '#login > button',
      '#rows > tr > td > button',
      '#rows > tr > td > button',
      'main > section > div > button',
      // id ":r1:" is a generated React id, so the ancestor isn't an anchor.
      'main > div:nth-of-type(2) > button',
    ]);
    assert.equal(out.snapshots[0].elements[0].label, 'link "a1"');
    assert.equal(out.snapshots[0].elements[4].label, 'radio "pro"');
    assert.deepEqual(out.interactions.map((i) => i.key), ['main > div:nth-of-type(1) > button', '#rows > tr > td > button']);
  });

  it('applies significantAttributes and attributeFilters at report time', () => {
    const out = resolveCoverageData(data(), {
      significantAttributes: ['data-action'],
      attributeFilters: [{ attribute: 'name', value: 'plan' }],
    });
    assert.ok(keys(out).includes('[data-action="del"]'));
    assert.ok(keys(out).includes('#login > input:nth-of-type(2)'));
  });

  it('applies ignoreSelectors to inventories and interactions, with reset', () => {
    const out = resolveCoverageData(data(), { ignoreSelectors: ['.cookie-banner', 'nav *', 'section'] });
    const k = keys(out);
    assert.ok(!k.some((x) => x.startsWith('nav')));
    assert.ok(!k.includes('main > div:nth-of-type(1) > button'));
    assert.ok(k.includes('main > section > div > button'), 'reset stops exclude-all aliases');
    assert.deepEqual(out.interactions.map((i) => i.key), ['#rows > tr > td > button']);
  });

  it('merges recorded (deprecated) rules; reporter rules win', () => {
    const recorded = data({ rules: { significantAttributes: ['data-action'] } });
    assert.ok(keys(resolveCoverageData(recorded)).includes('[data-action="del"]'));
    assert.ok(!keys(resolveCoverageData(recorded, { significantAttributes: [] })).includes('[data-action="del"]'));
    assert.deepEqual(mergeRules({ ignoreSelectors: ['a'] }, { significantAttributes: ['x'] }), {
      significantAttributes: ['x'],
      ignoreSelectors: ['a'],
    });
  });

  it('passes pre-0.2 data through and rejects unknown versions', () => {
    const legacy = { interactions: [], snapshots: [{ url: 'u', dpr: 1, elements: [{ key: 'k', label: 'l', tag: 'a', ...box }] }] };
    assert.equal(resolveCoverageData(legacy), legacy);
    assert.throws(() => resolveCoverageData({ ...data(), formatVersion: 99 }), /formatVersion 99/);
  });

  it('validateRules reports bad selectors and regexes', () => {
    assert.throws(() => validateRules({ ignoreSelectors: ['a:has(b)'] }), /:has/);
    assert.throws(() => validateRules({ attributeFilters: [{ attribute: '(' }] }), /attributeFilters/);
    assert.throws(() => validateRules({ ignoreSelectors: '.x' }), /must be an array/);
  });
});
