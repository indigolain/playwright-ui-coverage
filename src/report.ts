/**
 * Builds the report from stored attempts. Shared by the reporter (right after
 * a run) and the `report` CLI (from `ui-coverage-report/data/`), so both give
 * the same result for the same data and options.
 */
import fs from 'node:fs';
import path from 'node:path';
import { aggregate, defaultNormalizeUrl, type CoverageSummary, type NormalizeUrl } from './aggregate';
import { addA11yHints } from './a11y';
import { toCoverageReport, type CoverageReport } from './coverage-report';
import { selectAttempts } from './attempts';
import { addSuggestedLocators } from './locators';
import { indexTests, mostRepeated } from './insights';
import { renderHtml } from './html';
import { DATA_FILE, DATA_FORMAT_VERSION, type ConfigTrace, type StoredData } from './model/raw';
import { resolveCoverageData, type CompiledRules, type RecordedCoverageData } from './model/resolve';
import { pickRules, validateRules, type UiCoverageRules } from './model/rules';
import { forDisplay, formatBaselineCheck, resolveBaselineOption, runBaseline, type BaselineOption } from './baseline';
import { reportMarkdown } from './markdown';
import { evaluateThresholds, formatThresholdResults, type ThresholdOption, type ThresholdResult } from './thresholds';

/**
 * What the report is built with: report-time rules plus reporter settings.
 * The config file (`UiCoverageConfig`) and the reporter options hold these
 * keys (plus `recording` and `profiles`); see `config.ts`.
 */
export interface ReportOptions extends UiCoverageRules {
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
  /**
   * Folder of Playwright's HTML report (relative to the config file), to link
   * each test under "Tested by" to its entry and trace there. Default: detected
   * from the `html` reporter in the config. `false`: no links.
   */
  htmlReport?: string | false;
  /**
   * Attribute used for `page.getByTestId()` in suggested locators. Default: the
   * `use.testIdAttribute` of the first project that sets it, else `data-testid`.
   */
  testIdAttribute?: string;
  /**
   * Keep the raw recordings and every screenshot in `<outputFolder>/data/`, so
   * the report can be rebuilt with `playwright-ui-coverage report`. Default: true.
   */
  saveData?: boolean;
  /**
   * Compare untested elements with a committed baseline file and fail only on
   * new ones (ratchet). `'ui-coverage-baseline.json'` (a file name) or `true`
   * is `{ file, mode: 'check' }`. The current state is always written to
   * `<file>.next.json` (check mode). See README "Baseline".
   */
  baseline?: BaselineOption;
  /**
   * Append a markdown summary (coverage per view, thresholds, baseline) to
   * the file in `$GITHUB_STEP_SUMMARY` when that variable is set (GitHub
   * Actions). Default: false.
   */
  githubSummary?: boolean;
}

export const DATA_DIR = 'data';

/** What a report is built from: the stored attempts and facts about the run. */
export type ReportInput = Pick<StoredData, 'attempts' | 'componentTestConfig' | 'htmlReport' | 'testIdAttribute' | 'config'>;

/** Snapshot screenshot references in a recording (raw and pre-0.2 data share this shape). */
const snapshotsOf = (data: unknown): { screenshot?: string }[] =>
  Array.isArray((data as any)?.snapshots) ? (data as any).snapshots : [];

/**
 * Writes attempts (with absolute screenshot paths) to `dataDir`: the JSON file
 * plus a copy of every screenshot, referenced by relative path.
 */
export function writeData(dataDir: string, input: ReportInput): void {
  const shotsDir = path.join(dataDir, 'screenshots');
  fs.mkdirSync(shotsDir, { recursive: true });
  let n = 0;
  const out = input.attempts.map((a) => {
    const data = structuredClone(a.data);
    for (const snap of snapshotsOf(data)) {
      if (!snap.screenshot) continue;
      const rel = `screenshots/${n++}${path.extname(snap.screenshot) || '.png'}`;
      try {
        fs.copyFileSync(snap.screenshot, path.join(dataDir, rel));
        snap.screenshot = rel;
      } catch {
        delete snap.screenshot;
      }
    }
    return { ...a, data };
  });
  const file: StoredData = {
    formatVersion: DATA_FORMAT_VERSION,
    generatedAt: new Date().toISOString(),
    ...(input.componentTestConfig ? { componentTestConfig: true } : {}),
    ...(input.htmlReport ? { htmlReport: input.htmlReport } : {}),
    ...(input.testIdAttribute ? { testIdAttribute: input.testIdAttribute } : {}),
    ...(input.config ? { config: input.config } : {}),
    attempts: out,
  };
  fs.writeFileSync(path.join(dataDir, DATA_FILE), JSON.stringify(file));
}

/** Reads `dataDir` (as written by `writeData`); screenshot paths become absolute. */
export function readData(dataDir: string): ReportInput {
  const file = path.join(dataDir, DATA_FILE);
  let parsed: StoredData;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`[playwright-ui-coverage] can't read ${file}: ${(e as Error).message}`);
  }
  if (parsed.formatVersion !== DATA_FORMAT_VERSION) {
    throw new Error(
      `[playwright-ui-coverage] ${file} has formatVersion ${parsed.formatVersion}; ` +
        `this version reads ${DATA_FORMAT_VERSION}`,
    );
  }
  for (const a of parsed.attempts) {
    for (const snap of snapshotsOf(a.data)) {
      if (snap.screenshot) snap.screenshot = path.resolve(dataDir, snap.screenshot);
    }
  }
  // Links to the HTML report are relative to the report folder; make them absolute until rebuilt.
  if (parsed.htmlReport)
    parsed.htmlReport = { ...parsed.htmlReport, path: path.resolve(path.dirname(dataDir), parsed.htmlReport.path) };
  return parsed;
}

/** Where relative paths in the options (`baseline.file`) are resolved from. */
export interface ReportContext {
  /** The Playwright config file's folder (reporter) or `--config`'s folder (CLI). Default: cwd. */
  baseDir?: string;
  /** Where the options came from, written to coverage.json as `config`. */
  config?: ConfigTrace;
}

export interface ReportResult {
  /** What coverage.json contains. */
  report: CoverageReport;
  /** Internal model the HTML report is rendered from. */
  summary: CoverageSummary;
  thresholds: ThresholdResult[];
  /** True when a threshold wasn't met or the baseline check found new gaps. */
  failed: boolean;
}

/**
 * Applies the rules in `options` to `attempts` and writes `index.html`,
 * `coverage.json` and `screens/` into `outDir` (other files there are kept).
 * `config` (where the options came from) is written into `coverage.json`.
 */
export function buildReport(
  input: ReportInput,
  options: ReportOptions,
  outDir: string,
  context: ReportContext = {},
): ReportResult {
  const baselineOption = resolveBaselineOption(options.baseline, context.baseDir ?? process.cwd());
  const rules = pickRules(options as Record<string, unknown>);
  validateRules(rules, 'reporter options');
  const cache = new Map<string, CompiledRules>();
  const resolved = input.attempts.map((a) => ({
    ...a,
    data: resolveCoverageData(a.data as RecordedCoverageData, rules, cache),
  }));
  // Auto-detect component testing from the config, or from the recorded data
  // (merge-reports runs with a different config).
  const viewBy = options.viewBy ?? 'auto';
  const byFile =
    viewBy === 'file' ||
    (viewBy === 'auto' && (!!input.componentTestConfig || resolved.some((a) => a.data.componentTest)));
  for (const a of resolved) {
    if (byFile && a.specFile) a.data = { ...a.data, view: a.specFile };
    else if (a.data.view !== undefined) {
      const { view: _, ...rest } = a.data;
      a.data = rest;
    }
  }
  const entries = selectAttempts(resolved, { countFailedTests: options.countFailedTests ?? false });
  const summary = aggregate(entries, {
    normalizeUrl: options.normalizeUrl ?? defaultNormalizeUrl,
    maxScreenshotsPerRoute: options.maxScreenshotsPerRoute ?? 3,
  });
  summary.tests = indexTests(resolved);
  const link = input.htmlReport;
  if (link && options.htmlReport !== false) {
    const rel = path.isAbsolute(link.path) ? path.relative(outDir, link.path).split(path.sep).join('/') || '.' : link.path;
    summary.htmlReport = { ...link, path: rel };
  }
  summary.mostRepeated = mostRepeated(summary);
  addSuggestedLocators(summary, { testIdAttribute: options.testIdAttribute ?? input.testIdAttribute ?? 'data-testid' });
  addA11yHints(summary);

  const screensDir = path.join(outDir, 'screens');
  fs.rmSync(screensDir, { recursive: true, force: true });
  fs.mkdirSync(screensDir, { recursive: true });
  let n = 0;
  for (const route of summary.routes) {
    for (const shot of route.screenshots) {
      const file = `screens/${n++}${path.extname(shot.source) || '.png'}`;
      try {
        fs.copyFileSync(shot.source, path.join(outDir, file));
        shot.source = file;
      } catch {
        shot.source = '';
      }
    }
    route.screenshots = route.screenshots.filter((s) => s.source);
  }

  const thresholds = evaluateThresholds(summary, options.threshold);
  const report = toCoverageReport(summary, thresholds, context.config);
  if (baselineOption) report.baseline = runBaseline(report, baselineOption, outDir);
  fs.writeFileSync(path.join(outDir, 'coverage.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outDir, 'index.html'), renderHtml(summary));

  const pad = (s: string, n: number) => s.padEnd(n);
  const width = Math.max(10, ...summary.routes.map((r) => r.route.length));
  console.log(`\nUI coverage: ${summary.percent}% (${summary.tested}/${summary.total} elements)`);
  for (const r of summary.routes) {
    console.log(`  ${pad(r.route, width)}  ${String(r.percent).padStart(5)}%  ${r.tested}/${r.total}`);
  }
  if (summary.failingOnly > 0) {
    console.log(`  ${summary.failingOnly} more element(s) touched only by failing tests (not counted)`);
  }
  if (summary.a11yHints) {
    console.log(`  ${summary.a11yHints} accessibility hint(s), informational (see the report)`);
  }
  const index = path.join(outDir, 'index.html');
  const rel = path.relative(process.cwd(), index);
  console.log(`  Report: ${rel.startsWith('..') ? index : rel}\n`);

  const { warnings, errors } = formatThresholdResults(thresholds, summary.routes.map((r) => r.route));
  warnings.forEach((w) => console.warn(w));
  if (errors.length) console.error(errors.join('\n') + '\n');
  let baselineFailed = false;
  if (report.baseline) {
    const lines = formatBaselineCheck(forDisplay(report.baseline, outDir));
    if (lines.info.length) console.log(lines.info.join('\n') + (lines.errors.length ? '' : '\n'));
    if (lines.errors.length) console.error(lines.errors.join('\n') + '\n');
    baselineFailed = report.baseline.status === 'failed';
  }
  if (options.githubSummary) appendGithubSummary(report);
  return { report, summary, thresholds, failed: errors.length > 0 || baselineFailed };
}

/** Appends `reportMarkdown` to `$GITHUB_STEP_SUMMARY`, when set. */
export function appendGithubSummary(report: CoverageReport, env: NodeJS.ProcessEnv = process.env): boolean {
  const file = env.GITHUB_STEP_SUMMARY;
  if (!file) return false;
  try {
    fs.appendFileSync(file, reportMarkdown(report) + '\n');
    return true;
  } catch (e) {
    console.warn(`UI coverage: can't write the GitHub step summary (${file}): ${(e as Error).message}`);
    return false;
  }
}
