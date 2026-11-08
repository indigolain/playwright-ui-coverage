// Checks that a sharded run merged with `merge-reports` gives the same UI
// coverage report as an unsharded run, with screenshots, even when the merge
// happens "on another machine" (blobs moved, test-results/ deleted).
//
//   npm run demo:sharded                          # fixture mode
//   UICOV_MODE=register npm run demo:sharded      # register mode
//
// PORT is passed through to the demo server.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = path.join(root, 'ui-coverage-report');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uicov-shards-'));
const SHARDS = 2;

function run(args, env = {}) {
  console.log(`\n$ npx playwright ${args.join(' ')}`);
  const r = spawnSync('npx', ['playwright', ...args], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) throw new Error(`playwright ${args[0]} exited with ${r.status}`);
}

const brief = (r) => {
  const { coverage, testedElementsCount: tested, untestedElementsCount: untested } = r.summary;
  return `${coverage}% (${tested}/${tested + untested})`;
};
const readReport = () => JSON.parse(fs.readFileSync(path.join(report, 'coverage.json'), 'utf8'));

// Everything except generatedAt and the screenshot picks (which depend on timing).
const comparable = (summary) =>
  JSON.stringify({
    summary: summary.summary,
    views: summary.views.map((r) => ({
      name: r.name,
      summary: r.summary,
      // Compare identity and results, not display labels: labels may contain
      // per-run text (counters, timestamps) by design.
      elements: r.elements
        .map((e) => ({ key: e.key, tested: e.tested, instances: e.instances, testIds: [...e.testIds].sort() }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    })),
  });

const countShots = (report) => report.views.reduce((n, v) => n + v.screenshots.length, 0);

try {
  // 1. Unsharded baseline.
  run(['test']);
  const baseline = readReport();

  // 2. Each shard writes a blob report into its own directory.
  for (let i = 1; i <= SHARDS; i++) {
    run(['test', `--shard=${i}/${SHARDS}`, '--reporter=blob'], {
      PLAYWRIGHT_BLOB_OUTPUT_DIR: path.join(tmp, `shard-${i}`),
    });
  }

  // 3. "Another machine": blobs collected into one fresh directory, no test-results/.
  const merged = path.join(tmp, 'all-blobs');
  fs.mkdirSync(merged);
  for (let i = 1; i <= SHARDS; i++) {
    for (const f of fs.readdirSync(path.join(tmp, `shard-${i}`))) {
      fs.copyFileSync(path.join(tmp, `shard-${i}`, f), path.join(merged, f));
    }
  }
  fs.rmSync(path.join(root, 'test-results'), { recursive: true, force: true });
  fs.rmSync(report, { recursive: true, force: true });

  // A merge config passes the reporter options; `--reporter` alone would drop
  // them. The UI coverage config file is next to playwright.config.ts, not the
  // merge config, so point the reporter at it.
  const mergeConfig = path.join(tmp, 'merge.config.mjs');
  fs.writeFileSync(
    mergeConfig,
    `export default ${JSON.stringify({
      reporter: [[path.join(root, 'src', 'reporter.ts'), { configFile: path.join(root, 'ui-coverage.config.ts'), outputFolder: report }]],
    })};\n`,
  );
  run(['merge-reports', '--config', mergeConfig, merged]);
  const result = readReport();

  // 4. Compare.
  const errors = [];
  if (comparable(result) !== comparable(baseline)) {
    errors.push(
      `coverage differs: merged ${brief(result)}, unsharded ${brief(baseline)}`,
    );
    const a = JSON.parse(comparable(result)).views;
    const b = JSON.parse(comparable(baseline)).views;
    for (const r of a) {
      const other = b.find((x) => x.name === r.name);
      const text = (els) => new Set((els ?? []).map((e) => JSON.stringify(e)));
      const [mine, theirs] = [text(r.elements), text(other?.elements)];
      for (const e of mine) if (!theirs.has(e)) errors.push(`  merged only (${r.name}): ${e}`);
      for (const e of theirs) if (!mine.has(e)) errors.push(`  unsharded only (${r.name}): ${e}`);
    }
  }
  if (result.config?.source?.file !== 'ui-coverage.config.ts')
    errors.push(`merged report's config source is ${JSON.stringify(result.config?.source)}, expected ui-coverage.config.ts`);
  for (const v of result.views) {
    for (const s of v.screenshots) {
      const file = path.join(report, s.file);
      if (!fs.existsSync(file) || fs.statSync(file).size === 0) errors.push(`missing screenshot ${s.file} (${v.name})`);
    }
  }
  // The merged report also keeps the raw data, for `playwright-ui-coverage report`.
  const dataFile = path.join(report, 'data', 'ui-coverage-data.json');
  if (!fs.existsSync(dataFile)) errors.push('merged report has no data/ui-coverage-data.json');
  else {
    const stored = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const shots = stored.attempts.flatMap((a) => a.data.snapshots ?? []).filter((s) => s.screenshot);
    const missing = shots.filter((s) => !fs.existsSync(path.join(report, 'data', s.screenshot)));
    if (shots.length === 0) errors.push('merged data/ has no screenshots');
    if (missing.length) errors.push(`${missing.length} screenshot(s) referenced in data/ are missing`);
  }
  const [got, want] = [countShots(result), countShots(baseline)];
  if (got === 0 && want > 0) errors.push('merged report has no screenshots');
  else if (got !== want) {
    // Short-lived UI states can miss a screenshot in either run (see README "Known limitations").
    console.warn(`warning: ${got} screenshots in merged report, ${want} in unsharded report`);
  }

  if (errors.length) {
    console.error(`\nSharding check FAILED:\n  ${errors.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    console.log(`\nSharding check passed: ${brief(result)}, ${got} screenshots.`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
