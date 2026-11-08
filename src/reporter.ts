import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FullConfig, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { isPassingResult } from './attempts';
import type { StoredAttempt } from './model/raw';
import { pickRules, validateRules } from './model/rules';
import { buildReport, DATA_DIR, readData, writeData, type ReportInput, type UiCoverageReporterOptions } from './report';
import { resolveHtmlReport, type HtmlReportLink } from './insights';
import { ATTACHMENT_NAME } from './types';

export type { UiCoverageReporterOptions } from './report';

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
function resolveScreenshots<T>(data: T, result: TestResult): T {
  const paths = new Map<string, string>();
  for (const a of result.attachments) if (a.path) paths.set(a.name, a.path);
  for (const snap of ((data as any)?.snapshots ?? []) as { screenshot?: string }[]) {
    if (!snap.screenshot) continue;
    const file = paths.get(snap.screenshot) ?? (path.isAbsolute(snap.screenshot) ? snap.screenshot : undefined);
    if (file) snap.screenshot = file;
    else delete snap.screenshot;
  }
  return data;
}

/**
 * The file name Playwright's HTML reporter gives this attempt's trace in its
 * attachments folder: the SHA-1 of the file's content plus its extension.
 */
function traceFileName(result: TestResult): string | undefined {
  const trace = result.attachments.find((a) => a.name === 'trace' && a.path);
  if (!trace?.path) return undefined;
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(trace.path)).digest('hex') + path.extname(trace.path);
  } catch {
    return undefined;
  }
}

class UiCoverageReporter implements Reporter {
  /** One entry per attachment per attempt; retries are resolved when the report is built. */
  private tests: StoredAttempt[] = [];
  private outputFolder = 'ui-coverage-report';
  private componentTestConfig = false;
  private htmlReport: HtmlReportLink | undefined;
  /** `use.testIdAttribute` of the first project that sets it. */
  private configTestIdAttribute: string | undefined;

  constructor(private options: UiCoverageReporterOptions = {}) {
    // Fail fast on bad rules (invalid regex, unsupported selector syntax).
    validateRules(pickRules(options as Record<string, unknown>), 'reporter options');
  }

  onBegin(config: FullConfig) {
    // Resolve relative to the config file's directory (like Playwright's html reporter).
    const configDir = config.configFile ? path.dirname(config.configFile) : process.cwd();
    this.outputFolder = path.resolve(configDir, this.options.outputFolder ?? 'ui-coverage-report');
    this.componentTestConfig = CT_CONFIG_KEY in config;
    this.htmlReport = resolveHtmlReport(config.reporter, configDir, this.outputFolder, this.options.htmlReport);
    this.configTestIdAttribute = config.projects.map((p) => p.use?.testIdAttribute).find((a): a is string => !!a);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    let trace: string | undefined | null = null; // computed on first use
    for (const a of result.attachments) {
      if (a.name !== ATTACHMENT_NAME || !a.body) continue;
      try {
        this.tests.push({
          testId: test.id,
          retry: result.retry,
          passed: isPassingResult(test, result),
          title: test.titlePath().filter(Boolean).slice(1).join(' › '),
          project: test.parent.project()?.name || undefined,
          trace: this.htmlReport ? (trace ??= traceFileName(result)) || undefined : undefined,
          tags: (test as { tags?: string[] }).tags,
          specFile: specView(test),
          data: resolveScreenshots(JSON.parse(a.body.toString('utf8')), result),
        });
      } catch {
        /* malformed attachment */
      }
    }
  }

  async onEnd() {
    if (this.tests.length === 0) return;
    fs.rmSync(this.outputFolder, { recursive: true, force: true });
    fs.mkdirSync(this.outputFolder, { recursive: true });
    let input: ReportInput = {
      attempts: this.tests,
      componentTestConfig: this.componentTestConfig,
      ...(this.htmlReport ? { htmlReport: this.htmlReport } : {}),
      ...(this.configTestIdAttribute ? { testIdAttribute: this.configTestIdAttribute } : {}),
    };
    if (this.options.saveData !== false) {
      // Build from what was written, so `playwright-ui-coverage report` on
      // this folder gives exactly the same report.
      const dataDir = path.join(this.outputFolder, DATA_DIR);
      writeData(dataDir, input);
      input = readData(dataDir);
    }
    const { failed } = buildReport(input, this.options, this.outputFolder);
    if (failed) return { status: 'failed' as const };
  }

  printsToStdio() {
    return false;
  }
}

export default UiCoverageReporter;
