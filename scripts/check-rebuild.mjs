// Checks that `playwright-ui-coverage report` rebuilds the reporter's report
// from ui-coverage-report/data/, and that report-time rules work:
//
//   1. the CLI with the same options gives exactly the reporter's coverage.json;
//   2. changing a filter in the CLI config changes the report (no test run);
//   3. a failing threshold makes the CLI exit with code 1;
//   4. rules set the deprecated way (use.uiCoverage) give the same report, are
//      recorded with the data, and can be overridden by the CLI config.
//
//   npm run check:rebuild                       # fixture mode (builds dist/ first)
//   UICOV_MODE=register npm run check:rebuild   # register mode
//
// PORT is passed through to the demo server.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = path.join(root, 'ui-coverage-report');
const data = path.join(report, 'data');
const cli = path.join(root, 'dist', 'cli.js');
const rulesConfig = path.join(root, 'demo', 'ui-coverage.config.json');
const rules = JSON.parse(fs.readFileSync(rulesConfig, 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uicov-rebuild-'));
const errors = [];

function runTests(env = {}) {
  console.log(`\n$ npx playwright test ${Object.keys(env).map((k) => `(${k}=${env[k]})`).join(' ')}`);
  const r = spawnSync('npx', ['playwright', 'test'], { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`playwright test exited with ${r.status}`);
}

function runCli(args) {
  console.log(`\n$ playwright-ui-coverage ${args.join(' ')}`);
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: root, stdio: 'inherit' });
  return r.status;
}

const read = (dir) => {
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'coverage.json'), 'utf8'));
  delete json.generatedAt;
  return json;
};
const exact = (s) => JSON.stringify(s);
/**
 * Like `exact`, for a report written to another folder: the link to
 * Playwright's HTML report is relative, so compare where it points instead.
 */
const relocated = (s, dir) =>
  JSON.stringify({ ...s, htmlReport: s.htmlReport && { ...s.htmlReport, path: path.resolve(dir, s.htmlReport.path) } });
// Like check-sharding: identity and results, not labels or screenshot picks (timing-dependent).
const comparable = (s) =>
  JSON.stringify({
    total: s.total,
    tested: s.tested,
    routes: s.routes.map((r) => ({
      route: r.route,
      total: r.total,
      tested: r.tested,
      elements: r.elements
        .map((e) => ({ key: e.key, tested: e.tested, instances: e.instances, testedBy: [...e.testedBy].sort() }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    })),
  });
const keys = (s) => s.routes.flatMap((r) => r.elements.map((e) => `${r.route} ${e.key}`));
const writeConfig = (name, content) => {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, content);
  return file;
};

try {
  if (!fs.existsSync(cli)) throw new Error('dist/cli.js missing: run `npm run build` first');

  // 1. Reporter vs CLI with the same options.
  runTests();
  const baseline = read(report);
  const same = path.join(tmp, 'same');
  if (runCli(['report', '--data', data, '--config', rulesConfig, '--out', same]) !== 0) errors.push('CLI rebuild failed');
  else if (relocated(read(same), same) !== relocated(baseline, report))
    errors.push('CLI rebuild differs from the reporter\'s coverage.json');
  // Default paths: --data defaults to ui-coverage-report/data, the report is rebuilt in place.
  if (runCli(['report', '--config', rulesConfig]) !== 0) errors.push('CLI rebuild with default paths failed');
  else if (exact(read(report)) !== exact(baseline)) errors.push('in-place CLI rebuild differs from the reporter\'s coverage.json');

  // 2. A changed filter (.mjs config) updates the report without running tests.
  const ignore = ['nav a', '[data-action="delete-user"]'];
  const filterConfig = writeConfig(
    'filter.config.mjs',
    `export default ${JSON.stringify({ ...rules, ignoreSelectors: ignore })};\n`,
  );
  const filteredOut = path.join(tmp, 'filtered');
  if (runCli(['report', '--data', data, '--config', filterConfig, '--out', filteredOut]) !== 0) {
    errors.push('CLI rebuild with ignoreSelectors failed');
  } else {
    const filtered = read(filteredOut);
    const removed = keys(baseline).filter((k) => / nav > a/.test(k) || k.endsWith(' [data-action="delete-user"]'));
    const left = keys(filtered).filter((k) => removed.includes(k));
    if (removed.length === 0) errors.push('filter check is vacuous: no nav links / delete buttons in the baseline');
    if (left.length) errors.push(`ignored elements still in the report: ${left.join(', ')}`);
    if (filtered.total !== baseline.total - removed.length)
      errors.push(`filtered total ${filtered.total}, expected ${baseline.total} - ${removed.length}`);
    else console.log(`filter check: ${baseline.total} → ${filtered.total} elements`);
  }

  // 3. Thresholds (.cjs config): exit code 1 when not met.
  const thresholdConfig = writeConfig('threshold.config.cjs', `module.exports = ${JSON.stringify({ ...rules, threshold: 99 })};\n`);
  const status = runCli(['report', '--data', data, '--config', thresholdConfig, '--out', path.join(tmp, 'threshold')]);
  if (status !== 1) errors.push(`CLI exit code with a failing threshold: ${status}, expected 1`);

  // 4. Deprecated use.uiCoverage rules: same report, recorded with the data, overridable.
  runTests({ UICOV_DEMO_LEGACY: '1' });
  const legacy = read(report);
  if (comparable(legacy) !== comparable(baseline)) errors.push('use.uiCoverage rules give a different report than reporter rules');
  const legacyOut = path.join(tmp, 'legacy');
  if (runCli(['report', '--data', data, '--out', legacyOut]) !== 0) errors.push('CLI rebuild of legacy data failed');
  else if (relocated(read(legacyOut), legacyOut) !== relocated(legacy, report))
    errors.push('CLI rebuild (rules recorded with the data) differs from the reporter');
  const overrideConfig = writeConfig('override.config.json', JSON.stringify({ significantAttributes: [] }));
  const overrideOut = path.join(tmp, 'override');
  if (runCli(['report', '--data', data, '--config', overrideConfig, '--out', overrideOut]) !== 0) {
    errors.push('CLI rebuild with overriding rules failed');
  } else if (keys(read(overrideOut)).some((k) => k.includes('data-action'))) {
    errors.push('reporter significantAttributes: [] did not override the recorded use.uiCoverage value');
  }

  if (errors.length) {
    console.error(`\nRebuild check FAILED:\n  ${errors.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    console.log(`\nRebuild check passed: ${baseline.percent}% (${baseline.tested}/${baseline.total}).`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
