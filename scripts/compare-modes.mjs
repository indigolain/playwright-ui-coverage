#!/usr/bin/env node
// Checks that two coverage.json files (e.g. fixture mode vs register mode)
// describe the same coverage.
//
//   node scripts/compare-modes.mjs <a/coverage.json> <b/coverage.json>
//
// Compared: totals, and per route every element by key: the coverage fields
// in COMPARED (interaction types, not counts). Text-derived fields (label, name, suggested locator, hints) are
// display-only and may contain live text (a counter, a clock), so they aren't.
//
// Ignored: generatedAt and the chosen screenshots. Those depend on timing, not
// on the recording mode: whether a short-lived state (a modal, a page the test
// leaves right away) gets a screenshot, and which test's snapshot wins the set
// cover, vary from run to run. Each file must contain at least one screenshot,
// though, so a broken capture still fails. Element order and testIds order
// depend on test order, so both are sorted.
import fs from 'node:fs';

const [fileA, fileB] = process.argv.slice(2);
if (!fileA || !fileB) {
  console.error('usage: compare-modes.mjs <a/coverage.json> <b/coverage.json>');
  process.exit(2);
}

function load(file) {
  if (!fs.existsSync(file)) {
    console.error(`✗ ${file} does not exist (no coverage was recorded?)`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// coverage.json schema v1 (docs/coverage-json.md).
const COMPARED = ['key', 'tag', 'instances', 'tested', 'testIds', 'failingTestIds', 'interactionCounts'];
const pick = (e) => Object.fromEntries(COMPARED.filter((k) => k in e).map((k) => [k, e[k]]));
const sorted = (list) => (Array.isArray(list) ? [...list].sort() : list);
const counts = (s) => ({
  coverage: s.coverage,
  testedElementsCount: s.testedElementsCount,
  untestedElementsCount: s.untestedElementsCount,
  testedLinksCount: s.testedLinksCount,
  untestedLinksCount: s.untestedLinksCount,
});

function normalize(report) {
  return {
    ...counts(report.summary),
    views: report.views.map((v) => ({
      name: v.name,
      ...counts(v.summary),
      elements: v.elements
        .map((e) => ({
          ...pick(e),
          testIds: sorted(e.testIds),
          failingTestIds: sorted(e.failingTestIds),
          // Event types only: counts depend on timing (scroll events coalesce, retried actions).
          interactionCounts: e.interactionCounts && Object.keys(e.interactionCounts).sort(),
        }))
        .sort((a, b) => a.key.localeCompare(b.key)),
      links: (v.links ?? [])
        .map((l) => ({ key: l.key, tested: l.tested, destinations: l.destinations, referrers: l.referrers.map((e) => e.key).sort() }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    })),
    untestedViews: (report.untestedViews ?? []).map((v) => v.name),
  };
}

/** Lists the paths where `a` and `b` differ. */
function diff(a, b, path = '$', out = []) {
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b) || a === null || b === null) {
    if (a !== b) out.push(`${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
  } else if (typeof a !== 'object') {
    if (a !== b) out.push(`${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
  } else if (Array.isArray(a) && a.every((x) => typeof x !== 'object')) {
    const missing = b.filter((x) => !a.includes(x));
    const extra = a.filter((x) => !b.includes(x));
    if (missing.length || extra.length || a.length !== b.length)
      out.push(`${path}: only in A ${JSON.stringify(extra)}, only in B ${JSON.stringify(missing)}`);
  } else {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], `${path}.${k}`, out);
  }
  return out;
}

const rawA = load(fileA);
const rawB = load(fileB);
for (const [file, summary] of [[fileA, rawA], [fileB, rawB]]) {
  const t = summary.summary;
  if (t.testedElementsCount + t.untestedElementsCount === 0) {
    console.error(`✗ ${file} has no elements`);
    process.exit(1);
  }
  if (!summary.views.some((v) => v.screenshots.length > 0)) {
    console.error(`✗ ${file} has no screenshots`);
    process.exit(1);
  }
}
const shots = (report) => report.views.map((v) => `${v.name}: ${v.screenshots.length}`).join(', ');
console.log(`screenshots per route (not compared): A ${shots(rawA)} | B ${shots(rawB)}`);

const a = normalize(rawA);
const b = normalize(rawB);
const differences = diff(a, b);
if (differences.length) {
  console.error(`✗ ${fileA} and ${fileB} differ:`);
  for (const d of differences.slice(0, 50)) console.error(`  ${d}`);
  process.exit(1);
}
console.log(`✓ same coverage: ${a.coverage}% (${a.testedElementsCount}/${a.testedElementsCount + a.untestedElementsCount} elements) across ${a.views.length} views`);
