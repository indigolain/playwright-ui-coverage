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

const readReport = () => JSON.parse(fs.readFileSync(path.join(report, 'coverage.json'), 'utf8'));

// Everything except generatedAt and the screenshot picks (which depend on timing).
const comparable = (summary) =>
  JSON.stringify({
    total: summary.total,
    tested: summary.tested,
    percent: summary.percent,
    routes: summary.routes.map((r) => ({
      route: r.route,
      total: r.total,
      tested: r.tested,
      elements: r.elements.map((e) => ({ ...e, testedBy: [...e.testedBy].sort() })),
    })),
  });

const countShots = (summary) => summary.routes.reduce((n, r) => n + r.screenshots.length, 0);

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

  run(['merge-reports', '--reporter', './src/reporter.ts', merged]);
  const result = readReport();

  // 4. Compare.
  const errors = [];
  if (comparable(result) !== comparable(baseline)) {
    errors.push(
      `coverage differs: merged ${result.percent}% (${result.tested}/${result.total}), ` +
        `unsharded ${baseline.percent}% (${baseline.tested}/${baseline.total})`,
    );
  }
  for (const r of result.routes) {
    for (const s of r.screenshots) {
      const file = path.join(report, s.source);
      if (!fs.existsSync(file) || fs.statSync(file).size === 0) errors.push(`missing screenshot ${s.source} (${r.route})`);
    }
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
    console.log(`\nSharding check passed: ${result.percent}% (${result.tested}/${result.total}), ${got} screenshots.`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
