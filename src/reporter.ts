import fs from 'node:fs';
import path from 'node:path';
import type { FullConfig, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { aggregate, defaultNormalizeUrl, type NormalizeUrl } from './aggregate';
import { isPassingResult, selectAttempts, type AttemptEntry } from './attempts';
import { renderHtml } from './html';
import { ATTACHMENT_NAME, type TestCoverageData } from './types';

export interface UiCoverageReporterOptions {
  /** Where to write the report. Default: "ui-coverage-report". */
  outputFolder?: string;
  /** Map a URL to a route/view name. Default strips query and replaces id-like segments with ":id". */
  normalizeUrl?: NormalizeUrl;
  /** Max screenshots shown per route. Default: 3. */
  maxScreenshotsPerRoute?: number;
  /** Fail the run (exit code 1) if overall coverage is below this percent. */
  threshold?: number;
  /**
   * Let interactions from attempts that didn't pass mark elements as tested.
   * Default: false (only the last passing attempt of each test counts; element
   * totals still include inventories from every attempt).
   */
  countFailedTests?: boolean;
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

  constructor(private options: UiCoverageReporterOptions = {}) {}

  onBegin(config: FullConfig) {
    // Resolve relative to the config file's directory (like Playwright's html reporter).
    const configDir = config.configFile ? path.dirname(config.configFile) : process.cwd();
    this.outputFolder = path.resolve(configDir, this.options.outputFolder ?? 'ui-coverage-report');
  }

  onTestEnd(test: TestCase, result: TestResult) {
    for (const a of result.attachments) {
      if (a.name !== ATTACHMENT_NAME || !a.body) continue;
      try {
        this.tests.push({
          testId: test.id,
          retry: result.retry,
          passed: isPassingResult(test, result),
          title: test.titlePath().filter(Boolean).slice(1).join(' › '),
          data: resolveScreenshots(JSON.parse(a.body.toString('utf8')) as TestCoverageData, result),
        });
      } catch {
        /* malformed attachment */
      }
    }
  }

  async onEnd() {
    if (this.tests.length === 0) return;
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
        const file = `screens/${n++}.png`;
        try {
          fs.copyFileSync(shot.source, path.join(this.outputFolder, file));
          shot.source = file;
        } catch {
          shot.source = '';
        }
      }
      route.screenshots = route.screenshots.filter((s) => s.source);
    }

    fs.writeFileSync(path.join(this.outputFolder, 'coverage.json'), JSON.stringify(summary, null, 2));
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

    if (this.options.threshold !== undefined && summary.percent < this.options.threshold) {
      console.error(`UI coverage ${summary.percent}% is below threshold ${this.options.threshold}%`);
      return { status: 'failed' as const };
    }
  }

  printsToStdio() {
    return false;
  }
}

export default UiCoverageReporter;
