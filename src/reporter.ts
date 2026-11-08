import fs from 'node:fs';
import path from 'node:path';
import type { FullConfig, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { aggregate, defaultNormalizeUrl, type NormalizeUrl } from './aggregate';
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
}

class UiCoverageReporter implements Reporter {
  private tests: { title: string; data: TestCoverageData }[] = [];
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
          title: test.titlePath().filter(Boolean).slice(1).join(' › '),
          data: JSON.parse(a.body.toString('utf8')),
        });
      } catch {
        /* malformed attachment */
      }
    }
  }

  async onEnd() {
    if (this.tests.length === 0) return;
    const summary = aggregate(this.tests, {
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
