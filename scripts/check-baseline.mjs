// End-to-end check of baseline mode, `compare` and the GitHub step summary on
// the demo:
//
//   1. UICOV_DEMO_BASELINE=update writes the baseline (and never fails);
//   2. check mode passes on the same tests and writes <file>.next.json;
//   3. UICOV_DEMO_GAP=1 (a test skips a step) makes the run fail with exactly
//      that element as a new gap, in coverage.json, the console, .next.json
//      and $GITHUB_STEP_SUMMARY;
//   4. the CLI: `baseline check` fails the same way, `baseline update` + check
//      passes, `compare` reports the gap as "was tested" (markdown and JSON).
//
//   npm run check:baseline                       # fixture mode (builds dist/ first)
//   UICOV_MODE=register npm run check:baseline   # register mode
//
// PORT is passed through to the demo server.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = path.join(root, 'ui-coverage-report', 'coverage.json');
const cli = path.join(root, 'dist', 'cli.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uicov-baseline-'));
const baselineFile = path.join(tmp, 'ui-coverage-baseline.json');
const nextFile = path.join(tmp, 'ui-coverage-baseline.next.json');
const summaryFile = path.join(tmp, 'step-summary.md');
const GAP = { view: '/settings', label: 'checkbox "Email notifications"' };
const errors = [];

function runTests(env) {
  console.log(`\n$ npx playwright test ${Object.entries(env).map(([k, v]) => `(${k}=${v})`).join(' ')}`);
  const r = spawnSync('npx', ['playwright', 'test'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, UICOV_DEMO_BASELINE_FILE: baselineFile, ...env },
  });
  return r.status;
}

function runCli(args, { quiet = false } = {}) {
  console.log(`\n$ playwright-ui-coverage ${args.join(' ')}`);
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  if (!quiet) process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const expect = (ok, message) => {
  if (!ok) errors.push(message);
};
const isGap = (g) => g.view === GAP.view && g.label === GAP.label;

try {
  if (!fs.existsSync(cli)) throw new Error('dist/cli.js missing: run `npm run build` first');

  // 1. Update mode writes the baseline.
  expect(runTests({ UICOV_DEMO_BASELINE: 'update' }) === 0, 'update run failed');
  expect(fs.existsSync(baselineFile), 'update mode wrote no baseline file');
  const base = readJson(report);
  fs.copyFileSync(report, path.join(tmp, 'base.json'));
  expect(base.baseline?.status === 'updated', `update run: baseline.status ${base.baseline?.status}, expected updated`);
  const baseline = readJson(baselineFile);
  const untested = base.summary.untestedElementsCount;
  const listed = Object.values(baseline.views).reduce((n, v) => n + v.untestedElements.length, 0);
  expect(listed === untested, `baseline lists ${listed} untested elements, coverage.json has ${untested}`);

  // 2. Same tests, check mode: passes, writes .next.json equal to the baseline.
  expect(runTests({ UICOV_DEMO_BASELINE: 'check' }) === 0, 'check run without changes failed');
  expect(readJson(report).baseline?.status === 'passed', 'check run without changes: baseline.status is not passed');
  expect(
    fs.existsSync(nextFile) && JSON.stringify(readJson(nextFile)) === JSON.stringify(baseline),
    '.next.json after an unchanged run differs from the baseline',
  );

  // 3. A skipped test step: a new gap fails the run.
  const status = runTests({
    UICOV_DEMO_BASELINE: 'check',
    UICOV_DEMO_GAP: '1',
    UICOV_DEMO_SUMMARY: '1',
    GITHUB_STEP_SUMMARY: summaryFile,
  });
  expect(status === 1, `check run with a new gap exited with ${status}, expected 1`);
  const head = readJson(report);
  fs.copyFileSync(report, path.join(tmp, 'head.json'));
  const gaps = head.baseline?.newGaps ?? [];
  expect(head.baseline?.status === 'failed', `gap run: baseline.status ${head.baseline?.status}, expected failed`);
  expect(gaps.length === 1 && isGap(gaps[0]), `gap run: newGaps ${JSON.stringify(gaps)}, expected only ${GAP.label}`);
  const next = readJson(nextFile);
  expect(next.views[GAP.view].untestedElements.includes(gaps[0]?.key), '.next.json lacks the new gap');
  const summary = fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, 'utf8') : '';
  expect(summary.includes('**Baseline: failed**, 1 new untested element'), 'step summary lacks the baseline failure');
  expect(summary.includes('Email notifications'), 'step summary lacks the new gap');

  // 4. CLI.
  const check = runCli(['baseline', 'check', '--report', report, '--file', baselineFile]);
  expect(check.status === 1, `baseline check exited with ${check.status}, expected 1`);
  expect(check.stderr.includes('1 new untested element(s)'), 'baseline check output lacks the new gap');
  const updated = path.join(tmp, 'updated.json');
  expect(runCli(['baseline', 'update', '--report', report, '--file', updated]).status === 0, 'baseline update failed');
  expect(runCli(['baseline', 'check', '--report', report, '--file', updated]).status === 0, 'check after update failed');

  const md = runCli(['compare', path.join(tmp, 'base.json'), path.join(tmp, 'head.json'), '--out', path.join(tmp, 'pr.md')]);
  expect(md.status === 0, 'compare failed');
  const markdown = fs.readFileSync(path.join(tmp, 'pr.md'), 'utf8');
  console.log(`\n--- compare --format markdown ---\n${markdown}---`);
  expect(markdown.startsWith('<!-- playwright-ui-coverage -->'), 'markdown lacks the sticky-comment marker');
  expect(markdown.includes('**1 new untested element**'), 'markdown lacks "1 new untested element"');
  expect(/checkbox "Email notifications" \(was tested\)/.test(markdown), 'markdown lacks the regressed element');
  const json = runCli(['compare', path.join(tmp, 'base.json'), path.join(tmp, 'head.json'), '--format', 'json'], { quiet: true });
  const comparison = JSON.parse(json.stdout);
  expect(
    comparison.newGaps.length === 1 && comparison.newGaps[0].reason === 'regressed' && comparison.delta < 0,
    `compare JSON: ${JSON.stringify(comparison.newGaps)}, delta ${comparison.delta}`,
  );

  if (errors.length) {
    console.error(`\nBaseline check FAILED:\n  ${errors.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    console.log(`\nBaseline check passed: ${base.summary.coverage}% → ${head.summary.coverage}%, 1 new gap detected.`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
