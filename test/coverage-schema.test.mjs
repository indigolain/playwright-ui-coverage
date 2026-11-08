// Checks the public coverage.json contract: schema/coverage.schema.json against
// the TypeScript types in src/coverage-report.ts, and real output against the
// schema. Run with the other unit tests:
//
//   npm test
//
// The demo's report (ui-coverage-report/coverage.json, from `npm run demo`) is
// validated too when it exists.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'vitest';
import { toCoverageReport, COVERAGE_SCHEMA_VERSION } from '../src/coverage-report';
import { evaluateThresholds } from '../src/thresholds';
import { checkBaseline } from '../src/baseline';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(fs.readFileSync(path.join(root, 'schema', 'coverage.schema.json'), 'utf8'));

// ---- A tiny JSON Schema validator (the subset the schema uses) ------------
// Strict: objects reject properties the schema doesn't list unless it sets
// `additionalProperties`, so new output fields must be added to the schema.

function resolve(ref) {
  assert.ok(ref.startsWith('#/'), `only local $refs: ${ref}`);
  return ref
    .slice(2)
    .split('/')
    .reduce((node, part) => {
      assert.ok(node && part in node, `unresolved $ref ${ref}`);
      return node[part];
    }, schema);
}

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const SUPPORTED = new Set([
  '$schema', '$id', '$ref', '$defs', 'title', 'description', 'type', 'const', 'enum', 'required', 'properties',
  'additionalProperties', 'items', 'minimum', 'maximum', 'format', 'x-internal',
]);

function validate(value, s, at = '$', errors = []) {
  for (const k of Object.keys(s)) if (!SUPPORTED.has(k)) errors.push(`${at}: schema keyword ${k} not supported by the test validator`);
  if (s.$ref) return validate(value, resolve(s.$ref), at, errors);
  const t = typeOf(value);
  if (s.type) {
    const types = [s.type].flat();
    if (!types.includes(t) && !(t === 'integer' && types.includes('number'))) {
      errors.push(`${at}: expected ${types.join('|')}, got ${t}`);
      return errors;
    }
  }
  if ('const' in s && value !== s.const) errors.push(`${at}: expected ${JSON.stringify(s.const)}, got ${JSON.stringify(value)}`);
  if (s.enum && !s.enum.includes(value)) errors.push(`${at}: ${JSON.stringify(value)} not in ${JSON.stringify(s.enum)}`);
  if (typeof value === 'number') {
    if (s.minimum !== undefined && value < s.minimum) errors.push(`${at}: ${value} < ${s.minimum}`);
    if (s.maximum !== undefined && value > s.maximum) errors.push(`${at}: ${value} > ${s.maximum}`);
  }
  if (s.format === 'date-time' && Number.isNaN(Date.parse(value))) errors.push(`${at}: not a date-time`);
  if (t === 'array' && s.items) value.forEach((v, i) => validate(v, s.items, `${at}[${i}]`, errors));
  if (t === 'object') {
    for (const r of s.required ?? []) if (!(r in value)) errors.push(`${at}: missing ${r}`);
    for (const [k, v] of Object.entries(value)) {
      if (s.properties && k in s.properties) validate(v, s.properties[k], `${at}.${k}`, errors);
      else if (typeof s.additionalProperties === 'object') validate(v, s.additionalProperties, `${at}.${k}`, errors);
      else if (s.additionalProperties !== true) errors.push(`${at}: unexpected property ${k}`);
    }
  }
  return errors;
}

const assertValid = (value) => {
  const errors = validate(value, schema);
  assert.deepEqual(errors, [], errors.slice(0, 20).join('\n'));
};

// ---- Fixture: an internal summary covering every optional field ------------

function summaryFixture() {
  const el = (over) => ({
    key: 'main > button', label: 'button "Save"', tag: 'button', instances: 1, tested: false,
    testedBy: [], testedByFailing: [], interactionCounts: {}, interactionTotal: 0, testCount: 0,
    testIds: [], failingTestIds: [], role: 'button', name: 'Save', nameFrom: 'text', attrs: { type: 'submit' },
    suggestedLocator: "await page.getByRole('button', { name: 'Save' }).click();", ...over,
  });
  return {
    generatedAt: new Date(0).toISOString(),
    total: 5, tested: 2, percent: 40, totalLinks: 2, testedLinks: 1, failingOnly: 1, a11yHints: 1,
    routes: [
      {
        route: '/users/:id', total: 5, tested: 2, percent: 40, totalLinks: 2, testedLinks: 1, failingOnly: 1, a11yHints: 1,
        elements: [
          el({ key: 'a', a11yHints: [{ rule: 'no-name', message: 'No accessible name' }] }),
          el({ key: 'b', testedByFailing: ['f › t2'], failingTestIds: ['t2'] }),
          el({ key: 'c', tested: true, testedBy: ['f › t1'], testIds: ['t1'], interactionCounts: { click: 2 }, interactionTotal: 2, testCount: 1 }),
        ],
        links: [
          {
            key: '/orders', label: 'link "Orders"', tested: false, destinations: ['/orders'], destinationCount: 1,
            referrers: [el({ key: 'nav > a', label: 'link "Orders"', tag: 'a', role: 'link', name: 'Orders', attrs: { href: '/orders' } })],
          },
          {
            key: '/users', label: 'link "Users" (+1 more)', tested: true, destinations: ['/users', '/users?page=2'], destinationCount: 2,
            referrers: [el({ key: 'nav > a:nth-of-type(2)', label: 'link "Users"', tag: 'a' }), el({ key: '#next', label: 'link "Next"', tag: 'a' })],
          },
        ],
        screenshots: [{ source: 'screens/0.png', dpr: 2, test: 'f › t1', testId: 't1', boxes: [{ key: 'c', x: 1, y: 2, w: 3, h: 4 }] }],
      },
    ],
    untestedViews: [
      { view: '/orders', destinations: ['/orders'], destinationCount: 1, referrers: [{ route: '/users/:id', label: 'link "Orders"', keys: ['nav > a'] }] },
    ],
    tests: [
      { id: 't1', title: 'f › t1', project: 'chromium', run: 0, passed: true, trace: 'abc.zip' },
      { id: 't2', title: 'f › t2', run: 1, passed: false },
    ],
    htmlReport: { path: '../playwright-report', attachmentsBaseURL: 'data/' },
    mostRepeated: [{ route: '/users/:id', key: 'c', label: 'button "Save"', tests: 2, interactions: 3, share: 100 }],
  };
}

describe('coverage.json', () => {
  it('maps the internal summary to the schema', () => {
    const summary = summaryFixture();
    const thresholds = evaluateThresholds(summary, { overall: 30, views: { '/users/*': 50, '/nope': 10, '/x/**': 1 } });
    const report = toCoverageReport(summary, thresholds);
    assertValid(report);
    assert.equal(report.schemaVersion, COVERAGE_SCHEMA_VERSION);
    assert.deepEqual(report.summary, {
      viewCount: 1, untestedViewCount: 1, coverage: 40, testedElementsCount: 1, untestedElementsCount: 2,
      testedLinksCount: 1, untestedLinksCount: 1, failingOnlyElementsCount: 1, a11yHintsCount: 1,
    });
    assert.deepEqual(report.views[0].links.map((l) => [l.key, l.tested, l.referrers.length]), [['/orders', false, 1], ['/users', true, 2]]);
    assert.deepEqual(report.untestedViews, [
      { name: '/orders', destinations: ['/orders'], destinationCount: 1, referrers: [{ view: '/users/:id', label: 'link "Orders"', keys: ['nav > a'] }] },
    ]);
    assert.equal(report.views[0].reportUrl, 'index.html#%2Fusers%2F%3Aid');
    assert.deepEqual(report.views[0].elements[1].failingTestIds, ['t2']);
    assert.deepEqual(
      report.thresholds.map((t) => [t.scope, t.view, t.pattern, t.status]),
      [
        ['overall', undefined, undefined, 'passed'],
        ['view', '/nope', undefined, 'missing'],
        ['view', '/users/:id', '/users/*', 'failed'],
        ['view', '/x/**', '/x/**', 'missing'],
      ],
    );
    assert.deepEqual(report.insights.mostRepeated[0], {
      view: '/users/:id', key: 'c', label: 'button "Save"', testCount: 2, interactionCount: 3, testShare: 100,
    });
    assert.deepEqual(report.tests[1], { id: 't2', title: 'f › t2', passed: false, retry: 1 });
  });

  it('the validator rejects what the schema forbids', () => {
    const report = toCoverageReport(summaryFixture(), []);
    const broken = structuredClone(report);
    broken.summary.coverage = '33.3';
    delete broken.views[0].reportUrl;
    broken.views[0].elements[0].extra = 1;
    broken.schemaVersion = 2;
    const errors = validate(broken, schema);
    assert.equal(errors.length, 4, errors.join('\n'));
    // The resolved config: `resolved` is free-form; the rest is checked.
    assertValid({ ...report, config: { source: { file: null, inline: [] }, profile: null, resolved: { viewBy: 'url', nested: { a: 1 } } } });
    assert.equal(validate({ ...report, config: { viewBy: 'url' } }, schema).length, 4);
  });

  it('a baseline check result matches the schema', () => {
    const report = toCoverageReport(summaryFixture(), []);
    const diff = checkBaseline(
      { baselineVersion: 1, views: { '/users/:id': { untestedElements: ['c', 'gone'] }, '/old': { untestedElements: ['x'] } } },
      report,
    );
    assert.ok(diff.newGaps.length && diff.resolved.length && diff.removedViews.length);
    assertValid({
      ...report,
      baseline: { file: '../ui-coverage-baseline.json', mode: 'check', status: 'failed', nextFile: '../ui-coverage-baseline.next.json', allowNewViews: false, ...diff, renamedViews: [{ from: '/a', to: '/b' }] },
    });
  });

  it('the demo report matches the schema', (ctx) => {
    const file = path.join(root, 'ui-coverage-report', 'coverage.json');
    if (!fs.existsSync(file)) return ctx.skip();
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    assertValid(report);
    const s = report.summary;
    assert.equal(s.viewCount, report.views.length);
    const sum = (k) => report.views.reduce((n, v) => n + v.summary[k], 0);
    for (const k of ['testedElementsCount', 'untestedElementsCount', 'testedLinksCount', 'untestedLinksCount', 'failingOnlyElementsCount', 'a11yHintsCount'])
      assert.equal(s[k], sum(k), k);
    assert.equal(s.untestedViewCount, report.untestedViews.length);
    for (const v of report.views) {
      assert.equal(v.summary.testedLinksCount, v.links.filter((l) => l.tested).length, v.name);
      assert.equal(v.summary.untestedLinksCount, v.links.filter((l) => !l.tested).length, v.name);
    }
    const ids = new Set(report.tests.map((x) => x.id));
    for (const v of report.views)
      for (const e of v.elements) for (const id of [...e.testIds, ...e.failingTestIds]) assert.ok(ids.has(id), `unknown test id ${id}`);
  });
});

// ---- The schema matches the TypeScript types -------------------------------

describe('schema/coverage.schema.json vs src/coverage-report.ts', () => {
  const file = path.join(root, 'src', 'coverage-report.ts');
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
  const interfaces = new Map();
  source.forEachChild((n) => {
    if (ts.isInterfaceDeclaration(n)) interfaces.set(n.name.text, n);
  });

  /** Members of an interface (with `extends`) or type literal: name → { optional, type }. */
  function members(node) {
    const out = new Map();
    for (const h of node.heritageClauses ?? [])
      for (const t of h.types) for (const [k, v] of members(interfaces.get(t.expression.getText()))) out.set(k, v);
    for (const m of node.members) out.set(m.name.getText(), { optional: !!m.questionToken, type: m.type });
    return out;
  }

  /** Follows $refs to a schema with properties, or a primitive schema. */
  const deref = (s) => (s.$ref ? deref(resolve(s.$ref)) : s);

  function compare(node, s, at, errors) {
    s = deref(s);
    const props = members(node);
    const schemaProps = Object.keys(s.properties ?? {});
    for (const k of props.keys()) if (!schemaProps.includes(k)) errors.push(`${at}: ${k} is in the type but not the schema`);
    for (const k of schemaProps) if (!props.has(k)) errors.push(`${at}: ${k} is in the schema but not the type`);
    for (const [k, { optional, type }] of props) {
      if (!s.properties?.[k]) continue;
      const required = (s.required ?? []).includes(k);
      if (required === optional) errors.push(`${at}.${k}: ${optional ? 'optional' : 'required'} in the type, not in the schema`);
      compareType(type, s.properties[k], `${at}.${k}`, errors);
    }
  }

  function compareType(type, s, at, errors) {
    const raw = s;
    s = deref(s);
    if (ts.isArrayTypeNode(type)) {
      if (s.type !== 'array') return errors.push(`${at}: array in the type, ${s.type} in the schema`);
      return compareType(type.elementType, s.items, `${at}[]`, errors);
    }
    if (ts.isTypeLiteralNode(type)) return compare(type, s, at, errors);
    if (ts.isTypeReferenceNode(type)) {
      const name = type.typeName.getText();
      if (name === 'Record') {
        if (s.type !== 'object' || !s.additionalProperties) errors.push(`${at}: Record needs additionalProperties`);
        return;
      }
      if (interfaces.has(name)) {
        if (raw.$ref !== `#/$defs/${name}`) errors.push(`${at}: ${name} in the type, ${raw.$ref ?? 'inline'} in the schema`);
        return;
      }
    }
    const text = type.getText();
    const expected = {
      string: ['string'], number: ['number', 'integer'], boolean: ['boolean'],
      'number | null': ['number,null'], 'string | null': ['string,null'], 'typeof COVERAGE_SCHEMA_VERSION': ['const'],
    }[text];
    const actual = s.const !== undefined ? 'const' : s.enum ? 'enum' : [s.type].flat().join(',');
    if (/^'[^']*'( \| '[^']*')*$/.test(text)) {
      const literals = text.split(' | ').map((x) => x.slice(1, -1));
      const allowed = s.enum ?? [s.const];
      if (JSON.stringify(literals) !== JSON.stringify(allowed)) errors.push(`${at}: ${text} vs ${JSON.stringify(allowed)}`);
    } else if (!expected) errors.push(`${at}: type ${text} not handled by this test`);
    else if (!expected.includes(actual)) errors.push(`${at}: ${text} in the type, ${actual} in the schema`);
  }

  it('every $def is an exported interface with the same properties', () => {
    const errors = [];
    compare(interfaces.get('CoverageReport'), schema, 'CoverageReport', errors);
    for (const name of Object.keys(schema.$defs)) {
      if (!interfaces.has(name)) errors.push(`$defs/${name} has no interface`);
      else compare(interfaces.get(name), schema.$defs[name], name, errors);
    }
    assert.deepEqual(errors, [], errors.join('\n'));
  });

  it('schemaVersion in the schema is COVERAGE_SCHEMA_VERSION', () => {
    assert.equal(schema.properties.schemaVersion.const, COVERAGE_SCHEMA_VERSION);
  });
});
