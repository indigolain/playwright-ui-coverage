// Checks that `playwright-ui-coverage report` rebuilds the reporter's report
// from ui-coverage-report/data/, and that report-time rules work:
//
//   1. the CLI with the same options gives exactly the reporter's coverage.json;
//   2. changing a filter in the CLI config changes the report (no test run),
//      also views (a pattern with groupBy, a viewFilter), elementFilters and
//      named elements;
//   3. a failing threshold makes the CLI exit with code 1;
//   4. rules set the deprecated way (use.uiCoverage) give the same report, are
//      recorded with the data, and can be overridden by the CLI config;
//   5. config files: profiles (CLI --profile, UI_COVERAGE_PROFILE, selection by
//      project, recording options reaching the recorder), the resolved config
//      in coverage.json, and validation errors (exit code 2).
//
//   npm run check:rebuild                       # fixture mode (builds dist/ first)
//   UICOV_MODE=register npm run check:rebuild   # register mode
//
// PORT is passed through to the demo server.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = path.join(root, 'ui-coverage-report');
const data = path.join(report, 'data');
const cli = path.join(root, 'dist', 'cli.js');
const rulesConfig = path.join(root, 'ui-coverage.config.ts');
const require = createRequire(import.meta.url);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uicov-rebuild-'));
const errors = [];

function runTests(env = {}) {
  console.log(`\n$ npx playwright test ${Object.keys(env).map((k) => `(${k}=${env[k]})`).join(' ')}`);
  const r = spawnSync('npx', ['playwright', 'test'], { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`playwright test exited with ${r.status}`);
}

function runCli(args, env = {}, { quiet = false } = {}) {
  console.log(`\n$ playwright-ui-coverage ${args.join(' ')}`);
  const r = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    stdio: quiet ? 'pipe' : 'inherit',
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return quiet ? { status: r.status, output: `${r.stdout}${r.stderr}` } : r.status;
}

const read = (dir) => {
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'coverage.json'), 'utf8'));
  delete json.generatedAt;
  return json;
};
const exact = (s) => JSON.stringify(s);
const brief = (r) => {
  const { coverage, testedElementsCount: tested, untestedElementsCount: untested } = r.summary;
  return `${coverage}% (${tested}/${tested + untested})`;
};
/**
 * Like `exact`, for a report written to another folder: the link to
 * Playwright's HTML report is relative, so compare where it points instead.
 */
const relocated = (s, dir) =>
  JSON.stringify({
    ...s,
    playwrightReport: s.playwrightReport && { ...s.playwrightReport, path: path.resolve(dir, s.playwrightReport.path) },
  });
// Like check-sharding: identity and results, not labels or screenshot picks (timing-dependent).
const comparable = (s) =>
  JSON.stringify({
    summary: s.summary,
    views: s.views.map((v) => ({
      name: v.name,
      summary: v.summary,
      elements: v.elements
        .map((e) => ({ key: e.key, tested: e.tested, instances: e.instances, testIds: [...e.testIds].sort() }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    })),
  });
const keys = (s) => s.views.flatMap((v) => v.elements.map((e) => `${v.name} ${e.key}`));
/** How coverage.json names a config file: relative to the working directory, absolute outside it. */
const traceFile = (file) => {
  const rel = path.relative(root, file);
  return rel.startsWith('..') ? file : rel.split(path.sep).join('/');
};
const writeConfig = (name, content) => {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, content);
  return file;
};

try {
  if (!fs.existsSync(cli)) throw new Error('dist/cli.js missing: run `npm run build` first');
  const { loadConfigFile } = require(path.join(root, 'dist', 'config.js'));
  const { profiles: _, ...rules } = await loadConfigFile(rulesConfig);

  // 1. Reporter vs CLI with the same options.
  runTests();
  const baseline = read(report);
  if (baseline.config?.source?.file !== 'ui-coverage.config.ts' || baseline.config.profile !== null)
    errors.push(`coverage.json config: ${JSON.stringify(baseline.config?.source)}, profile ${baseline.config?.profile}`);
  const same = path.join(tmp, 'same');
  if (runCli(['report', '--data', data, '--config', rulesConfig, '--out', same]) !== 0) errors.push('CLI rebuild failed');
  else if (relocated(read(same), same) !== relocated(baseline, report))
    errors.push('CLI rebuild differs from the reporter\'s coverage.json');
  // Default paths: --data defaults to ui-coverage-report/data, the report is rebuilt in place.
  if (runCli(['report', '--config', rulesConfig]) !== 0) errors.push('CLI rebuild with default paths failed');
  else if (exact(read(report)) !== exact(baseline)) errors.push('in-place CLI rebuild differs from the reporter\'s coverage.json');

  // 2. A changed filter (.mjs config) updates the report without running tests.
  //    The documentScope entry targets the buttons inside the cross-origin frame on /embedded.
  const payments = '[data-testid="payments"]';
  const ignore = ['nav a', '[data-action="delete-user"]', { selector: 'button', documentScope: payments }];
  const filterConfig = writeConfig(
    'filter.config.mjs',
    `export default ${JSON.stringify({ ...rules, ignoreSelectors: ignore })};\n`,
  );
  const filteredOut = path.join(tmp, 'filtered');
  if (runCli(['report', '--data', data, '--config', filterConfig, '--out', filteredOut]) !== 0) {
    errors.push('CLI rebuild with ignoreSelectors failed');
  } else {
    const filtered = read(filteredOut);
    const inFrame = new Set(
      baseline.views.flatMap((v) =>
        v.elements.filter((e) => e.tag === 'button' && e.frames?.[0] === payments).map((e) => `${v.name} ${e.key}`),
      ),
    );
    if (inFrame.size === 0) errors.push('documentScope check is vacuous: no buttons in the payments frame');
    const removed = keys(baseline).filter(
      (k) => / nav > a/.test(k) || k.endsWith(' [data-action="delete-user"]') || inFrame.has(k),
    );
    const left = keys(filtered).filter((k) => removed.includes(k));
    if (removed.length === 0) errors.push('filter check is vacuous: no nav links / delete buttons in the baseline');
    if (left.length) errors.push(`ignored elements still in the report: ${left.join(', ')}`);
    const total = (s) => s.summary.testedElementsCount + s.summary.untestedElementsCount;
    if (total(filtered) !== total(baseline) - removed.length)
      errors.push(`filtered total ${total(filtered)}, expected ${total(baseline)} - ${removed.length}`);
    else console.log(`filter check: ${total(baseline)} → ${total(filtered)} elements`);
  }

  // 2b. Views and element rules, changed in the CLI config (no test run):
  //  - views: '/users/:id' grouped by id → '/users/1'; viewFilters: '/widgets' dropped;
  //  - elementFilters: only the "Home" nav link is kept (an include protects it from
  //    the `nav *` exclude), and without the demo's `footer *` rule the two footer links count;
  //  - elements: the named star button gets another name.
  const navLink = /(^| )nav > a:nth-of-type\((\d)\)$/;
  const viewsConfig = writeConfig(
    'views.config.mjs',
    `export default ${JSON.stringify({
      ...rules,
      views: [{ pattern: '/users/:id', groupBy: ['id'] }],
      viewFilters: [...(rules.viewFilters ?? []), { pattern: '/widgets', include: false }],
      elementFilters: [
        { selector: 'nav a[href="/"]', include: true },
        { selector: 'nav *', include: false },
      ],
      elements: [{ selector: 'main > div:nth-of-type(2) > button', name: 'Favorite' }],
    })};\n`,
  );
  const viewsOut = path.join(tmp, 'views');
  if (runCli(['report', '--data', data, '--config', viewsConfig, '--out', viewsOut]) !== 0) {
    errors.push('CLI rebuild with views and element rules failed');
  } else {
    const changed = read(viewsOut);
    const rename = { '/users/:id': '/users/1' };
    const expectedViews = baseline.views
      .map((v) => rename[v.name] ?? v.name)
      .filter((n) => n !== '/widgets')
      .sort();
    const gotViews = changed.views.map((v) => v.name).sort();
    if (exact(gotViews) !== exact(expectedViews)) errors.push(`views: got ${gotViews.join(', ')}, expected ${expectedViews.join(', ')}`);
    const star = 'Star user (icon button)';
    if (!keys(baseline).includes(`/users/:id ${star}`)) errors.push('named element check is vacuous: no named star button in the baseline');
    for (const v of baseline.views) {
      const name = rename[v.name] ?? v.name;
      const got = changed.views.find((x) => x.name === name);
      if (name === '/widgets') continue;
      if (!got) continue; // reported above
      const expected = v.elements
        .map((e) => (e.key === star ? 'Favorite' : e.key))
        .filter((k) => !navLink.test(k) || navLink.exec(k)[2] === '1');
      if (name === '/') expected.push('footer > a:nth-of-type(1)', 'footer > a:nth-of-type(2)');
      const gotKeys = got.elements.map((e) => e.key).sort();
      if (exact(gotKeys) !== exact(expected.sort()))
        errors.push(`${name}: keys ${gotKeys.join(', ')}; expected ${expected.join(', ')}`);
    }
    const total = (s) => s.summary.testedElementsCount + s.summary.untestedElementsCount;
    console.log(`views and element rules check: ${baseline.views.length} → ${changed.views.length} views, ${total(baseline)} → ${total(changed)} elements`);
  }

  // 3. Thresholds (.cjs config): exit code 1 when not met.
  const thresholdConfig = writeConfig('threshold.config.cjs', `module.exports = ${JSON.stringify({ ...rules, threshold: 99 })};\n`);
  const status = runCli(['report', '--data', data, '--config', thresholdConfig, '--out', path.join(tmp, 'threshold')]);
  if (status !== 1) errors.push(`CLI exit code with a failing threshold: ${status}, expected 1`);

  // 4. Deprecated use.uiCoverage rules: same report, recorded with the data, overridable.
  runTests({ UICOV_DEMO_LEGACY: '1' });
  const legacy = read(report);
  if (comparable(legacy) !== comparable(baseline)) errors.push('use.uiCoverage rules give a different report than reporter rules');
  if (legacy.config?.source?.file !== null) errors.push('legacy run (configFile: false) still used a config file');
  const legacyOut = path.join(tmp, 'legacy');
  // UI_COVERAGE_CONFIG to a config with only the rules the legacy run passed inline (they
  // can't be set in use.uiCoverage): the CLI would otherwise find ui-coverage.config.ts.
  const inlineOnly = Object.fromEntries(
    ['views', 'viewFilters', 'elementFilters', 'elements'].filter((k) => rules[k] !== undefined).map((k) => [k, rules[k]]),
  );
  const empty = writeConfig('legacy-inline.config.json', JSON.stringify(inlineOnly));
  const legacyRebuild = { ...legacy, config: { ...legacy.config, source: { file: traceFile(empty), inline: [] } } };
  if (runCli(['report', '--data', data, '--out', legacyOut], { UI_COVERAGE_CONFIG: empty }) !== 0)
    errors.push('CLI rebuild of legacy data failed');
  else if (relocated(read(legacyOut), legacyOut) !== relocated(legacyRebuild, report))
    errors.push('CLI rebuild (rules recorded with the data) differs from the reporter');
  const overrideConfig = writeConfig('override.config.json', JSON.stringify({ significantAttributes: [] }));
  const overrideOut = path.join(tmp, 'override');
  if (runCli(['report', '--data', data, '--config', overrideConfig, '--out', overrideOut]) !== 0) {
    errors.push('CLI rebuild with overriding rules failed');
  } else if (keys(read(overrideOut)).some((k) => k.includes('data-action'))) {
    errors.push('reporter significantAttributes: [] did not override the recorded use.uiCoverage value');
  }

  // 5. Profiles and validation. A profile selected by project name changes a
  // recording option (only clicks count) and a report setting.
  const profileConfig = writeConfig(
    'profiles.config.mjs',
    `export default ${JSON.stringify({
      ...rules,
      profiles: [
        { name: 'strict', comment: 'explicit only', config: { threshold: 99 } },
        { name: 'clicks-only', projects: [process.env.BROWSER || 'chromium'], config: { recording: { interactions: ['click'] }, maxScreenshotsPerRoute: 1 } },
      ],
    })};\n`,
  );
  runTests({ UI_COVERAGE_CONFIG: profileConfig });
  const clicks = read(report);
  if (clicks.config?.profile !== 'clicks-only') errors.push(`profile by project: got ${clicks.config?.profile}`);
  if (JSON.stringify(clicks.config?.resolved?.recording?.interactions) !== '["click"]')
    errors.push('resolved config in coverage.json lacks the profile\'s recording.interactions');
  if (!(clicks.summary.testedElementsCount < baseline.summary.testedElementsCount))
    errors.push(`profile recording options not applied: ${brief(clicks)}, baseline ${brief(baseline)}`);
  if (clicks.views.some((v) => v.screenshots.length > 1)) errors.push('profile maxScreenshotsPerRoute not applied');
  const stored = JSON.parse(fs.readFileSync(path.join(data, 'ui-coverage-data.json'), 'utf8'));
  if (stored.config?.profile !== 'clicks-only') errors.push('data folder does not record the profile');
  // The CLI picks the recorded profile; an explicit one wins.
  if (runCli(['report', '--config', profileConfig]) !== 0) errors.push('CLI rebuild with the recorded profile failed');
  else if (exact(read(report)) !== exact({ ...clicks, config: { ...clicks.config, source: { file: traceFile(profileConfig), inline: [] } } }))
    errors.push('CLI rebuild with the recorded profile differs from the reporter');
  if (runCli(['report', '--config', profileConfig, '--profile', 'strict', '--out', path.join(tmp, 'strict')]) !== 1)
    errors.push('--profile strict (threshold 99) should exit with 1');
  if (runCli(['report', '--config', profileConfig, '--out', path.join(tmp, 'env')], { UI_COVERAGE_PROFILE: 'strict' }) !== 1)
    errors.push('UI_COVERAGE_PROFILE=strict should exit with 1');
  const unknown = runCli(['report', '--config', profileConfig, '--profile', 'nope'], {}, { quiet: true });
  if (unknown.status !== 2 || !unknown.output.includes('"clicks-only"')) errors.push(`unknown profile: ${unknown.status} ${unknown.output}`);
  const typo = writeConfig('typo.config.json', JSON.stringify({ ignoreSelector: ['nav a'], recording: { snapshotDelay: 'x' } }));
  const bad = runCli(['report', '--config', typo], {}, { quiet: true });
  if (bad.status !== 2 || !bad.output.includes('did you mean "ignoreSelectors"') || !bad.output.includes('recording.snapshotDelay'))
    errors.push(`invalid config: exit ${bad.status}, output:\n${bad.output}`);

  if (errors.length) {
    console.error(`\nRebuild check FAILED:\n  ${errors.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    const { coverage, testedElementsCount: tested, untestedElementsCount: untested } = baseline.summary;
    console.log(`\nRebuild check passed: ${coverage}% (${tested}/${tested + untested}).`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
