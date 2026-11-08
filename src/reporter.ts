import fs from 'node:fs';
import path from 'node:path';
import type { FullConfig, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { aggregate, defaultNormalizeUrl, type NormalizeUrl } from './aggregate';
import { isPassingResult, selectAttempts, type AttemptEntry } from './attempts';
import { renderHtml } from './html';
import { evaluateThresholds, formatThresholdResults, type ThresholdOption } from './thresholds';
import { ATTACHMENT_NAME, type TestCoverageData } from './types';

export interface UiCoverageReporterOptions {
  /** Where to write the report. Default: "ui-coverage-report". */
  outputFolder?: string;
  /** Map a URL to a route/view name. Default strips query and replaces id-like segments with ":id". */
  normalizeUrl?: NormalizeUrl;
  /** Max screenshots shown per route. Default: 3. */
  maxScreenshotsPerRoute?: number;
  /**
   * Fail the run (exit code 1) if coverage is below these percents. A number is
   * shorthand for `{ overall }`. `views` keys are route names as shown in the
   * report, or globs (`*` = one segment, `**` = any); an exact key beats a pattern.
   */
  threshold?: ThresholdOption;
  /**
   * Let interactions from attempts that didn't pass mark elements as tested.
   * Default: false (only the last passing attempt of each test counts; element
   * totals still include inventories from every attempt).
   */
  countFailedTests?: boolean;
  /**
   * How tests' data is grouped into views:
   * - `'url'`: by page URL, through `normalizeUrl` (E2E tests).
   * - `'file'`: one view per spec file, named by its path relative to the
   *   project's `testDir` (e.g. `components/Button.spec.tsx`). For component
   *   tests, where every test loads the same URL.
   * - `'auto'` (default): `'file'` for Playwright component testing
   *   (`@playwright/experimental-ct-*`), `'url'` otherwise.
   */
  viewBy?: 'url' | 'file' | 'auto';
}

const CT_CONFIG_KEY = '@playwright/experimental-ct-core';

/** Spec file path relative to the project's testDir, with `/` separators. */
function specView(test: TestCase): string {
  const testDir = test.parent.project()?.testDir;
  const file = testDir ? path.relative(testDir, test.location.file) : path.basename(test.location.file);
  return file.split(path.sep).join('/');
}

/**
 * Replaces each snapshot's screenshot attachment name with the file's local
 * path from `result.attachments`. merge-reports rewrites those paths to where
 * it extracted the blob, so this works on any machine. Values that are already
 * absolute paths (data from older versions) are kept as they are.
 */
function resolveScreenshots(data: TestCoverageData, result: TestResult): TestCoverageData {
  const paths = new Map<string, string>();
  for (const a of result.attachments) if (a.path) paths.set(a.name, a.path);
  for (const snap of data.snapshots ?? []) {
    if (!snap.screenshot) continue;
    const file = paths.get(snap.screenshot) ?? (path.isAbsolute(snap.screenshot) ? snap.screenshot : undefined);
    if (file) snap.screenshot = file;
    else delete snap.screenshot;
  }
  return data;
}

class UiCoverageReporter implements Reporter {
  /** One entry per attachment per attempt; retries are resolved in onEnd. */
  private tests: AttemptEntry[] = [];
  private outputFolder = 'ui-coverage-report';
  /** Each attachment's spec file view, applied in onEnd when grouping by file. */
  private specViews = new Map<TestCoverageData, string>();
  private componentTestConfig = false;

  constructor(private options: UiCoverageReporterOptions = {}) {}

  onBegin(config: FullConfig) {
    // Resolve relative to the config file's directory (like Playwright's html reporter).
    const configDir = config.configFile ? path.dirname(config.configFile) : process.cwd();
    this.outputFolder = path.resolve(configDir, this.options.outputFolder ?? 'ui-coverage-report');
    this.componentTestConfig = CT_CONFIG_KEY in config;
  }

  onTestEnd(test: TestCase, result: TestResult) {
    for (const a of result.attachments) {
      if (a.name !== ATTACHMENT_NAME || !a.body) continue;
      try {
        const data = resolveScreenshots(JSON.parse(a.body.toString('utf8')) as TestCoverageData, result);
        this.specViews.set(data, specView(test));
        this.tests.push({
          testId: test.id,
          retry: result.retry,
          passed: isPassingResult(test, result),
          title: test.titlePath().filter(Boolean).slice(1).join(' › '),
          data,
        });
      } catch {
        /* malformed attachment */
      }
    }
  }

  async onEnd() {
    if (this.tests.length === 0) return;
    // Auto-detect component testing from the config, or from the recorded data
    // (merge-reports runs with a different config).
    const viewBy = this.options.viewBy ?? 'auto';
    const byFile =
      viewBy === 'file' ||
      (viewBy === 'auto' && (this.componentTestConfig || this.tests.some((t) => t.data.componentTest)));
    for (const [data, view] of this.specViews) {
      if (byFile) data.view = view;
      else delete data.view;
    }
    const entries = selectAttempts(this.tests, { countFailedTests: this.options.countFailedTests ?? false });
    const summary = aggregate(entries, {
      normalizeUrl: this.options.normalizeUrl ?? defaultNormalizeUrl,
      maxScreenshotsPerRoute: this.options.maxScreenshotsPerRoute ?? 3,
    });

    fs.rmSync(this.outputFolder, { recursive: true, force: true });
    const screensDir = path.join(this.outputFolder, 'screens');
    fs.mkdirSync(screensDir, { recursive: true });

    let n = 0;
    for (const route of summary.routes) {
      for (const shot of route.screenshots) {
        const file = `screens/${n++}${path.extname(shot.source) || '.png'}`;
        try {
          fs.copyFileSync(shot.source, path.join(this.outputFolder, file));
          shot.source = file;
        } catch {
          shot.source = '';
        }
      }
      route.screenshots = route.screenshots.filter((s) => s.source);
    }

    const thresholds = evaluateThresholds(summary, this.options.threshold);
    const json = this.options.threshold === undefined ? summary : { ...summary, thresholds };
    fs.writeFileSync(path.join(this.outputFolder, 'coverage.json'), JSON.stringify(json, null, 2));
    fs.writeFileSync(path.join(this.outputFolder, 'index.html'), renderHtml(summary));

    const pad = (s: string, n: number) => s.padEnd(n);
    const width = Math.max(10, ...summary.routes.map((r) => r.route.length));
    console.log(`\nUI coverage: ${summary.percent}% (${summary.tested}/${summary.total} elements)`);
    for (const r of summary.routes) {
      console.log(`  ${pad(r.route, width)}  ${String(r.percent).padStart(5)}%  ${r.tested}/${r.total}`);
    }
    if (summary.failingOnly > 0) {
      console.log(`  ${summary.failingOnly} more element(s) touched only by failing tests (not counted)`);
    }
    const rel = path.relative(process.cwd(), path.join(this.outputFolder, 'index.html'));
    console.log(`  Report: ${rel}\n`);

    const { warnings, errors } = formatThresholdResults(thresholds, summary.routes.map((r) => r.route));
    warnings.forEach((w) => console.warn(w));
    if (errors.length) {
      console.error(errors.join('\n') + '\n');
      return { status: 'failed' as const };
    }
  }

  printsToStdio() {
    return false;
  }
}

export default UiCoverageReporter;
