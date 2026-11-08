import fs from 'node:fs';
import path from 'node:path';
import type { CoverageSummary } from './aggregate';
import type { AttemptEntry } from './attempts';

/** A test as listed under "Tested by", with what's needed to link to it. */
export interface TestInfo {
  /** `TestCase.id`, as used by Playwright's HTML report (`#?testId=`). */
  id: string;
  title: string;
  project?: string;
  /**
   * Index of the attempt the report links to (`TestResult.retry`, the HTML
   * report's `run`): the last passing attempt, or the last attempt if none passed.
   */
  run: number;
  /** Whether that attempt passed. */
  passed: boolean;
  /** Trace of that attempt, as a file name in the HTML report's attachments folder. */
  trace?: string;
}

/**
 * One entry per test (by id), pointing at the attempt whose interactions
 * counted: the last passing one, or the last one when no attempt passed.
 */
export function indexTests(entries: AttemptEntry[]): TestInfo[] {
  const chosen = new Map<string, AttemptEntry>();
  for (const e of entries) {
    const cur = chosen.get(e.testId);
    const better = !cur || (e.passed && !cur.passed) || (e.passed === cur.passed && e.retry > cur.retry);
    if (better) chosen.set(e.testId, e);
  }
  return [...chosen.values()]
    .map((e) => {
      const t: TestInfo = { id: e.testId, title: e.title, run: e.retry, passed: e.passed };
      if (e.project) t.project = e.project;
      if (e.trace) t.trace = e.trace;
      return t;
    })
    .sort((a, b) => a.title.localeCompare(b.title) || (a.project ?? '').localeCompare(b.project ?? '') || a.id.localeCompare(b.id));
}

export interface RepeatedElement {
  route: string;
  key: string;
  label: string;
  /** Distinct tests whose interactions counted. */
  tests: number;
  /** Counted interactions, all types. */
  interactions: number;
  /** `tests` as a percent of all tests in the report. */
  share: number;
}

/** Sum of an element's `interactionCounts`. */
export const interactionTotal = (counts: Record<string, number> | undefined) =>
  Object.values(counts ?? {}).reduce((s, n) => s + n, 0);

/**
 * Elements used by the most tests (at least 2), most first. These are often
 * setup steps (logging in, creating data) repeated in every test.
 */
export function mostRepeated(summary: CoverageSummary, limit = 10): RepeatedElement[] {
  const totalTests =
    summary.tests?.length ||
    new Set(summary.routes.flatMap((r) => r.elements.flatMap((e) => e.testIds ?? e.testedBy))).size;
  const all: RepeatedElement[] = [];
  for (const r of summary.routes) {
    for (const e of r.elements) {
      const tests = e.testCount ?? e.testedBy.length;
      if (tests < 2) continue;
      all.push({
        route: r.route,
        key: e.key,
        label: e.label,
        tests,
        interactions: e.interactionTotal ?? interactionTotal(e.interactionCounts),
        share: totalTests ? Math.round((tests / totalTests) * 1000) / 10 : 0,
      });
    }
  }
  return all
    .sort((a, b) => b.tests - a.tests || b.interactions - a.interactions || a.route.localeCompare(b.route) || a.key.localeCompare(b.key))
    .slice(0, limit);
}

/** Where tests and traces link to in Playwright's HTML report. */
export interface HtmlReportLink {
  /** The HTML report folder, relative to the UI coverage report folder (`/` separators). */
  path: string;
  /** The HTML reporter's `attachmentsBaseURL` (default `data/`), where traces are. */
  attachmentsBaseURL: string;
}

/** Same default as Playwright: next to the nearest package.json, else the working directory. */
function defaultHtmlFolder(configDir: string): string {
  for (let dir = configDir; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return path.join(dir, 'playwright-report');
    if (path.dirname(dir) === dir) return path.join(process.cwd(), 'playwright-report');
  }
}

/**
 * Finds Playwright's HTML reporter in the config and resolves its output
 * folder the way it does (`PLAYWRIGHT_HTML_OUTPUT_DIR`, `outputFolder`
 * relative to the config, or `playwright-report`). `override` (the
 * `htmlReport` reporter option) replaces detection; `false` turns links off.
 */
export function resolveHtmlReport(
  reporters: ReadonlyArray<readonly [string, any?]>,
  configDir: string,
  outputFolder: string,
  override?: string | false,
): HtmlReportLink | undefined {
  if (override === false) return undefined;
  const html = reporters.find(([name]) => name === 'html');
  if (override === undefined && !html) return undefined;
  const opts = (html?.[1] ?? {}) as { outputFolder?: string; attachmentsBaseURL?: string };
  const env = process.env.PLAYWRIGHT_HTML_OUTPUT_DIR || process.env.PLAYWRIGHT_HTML_REPORT;
  const folder =
    override !== undefined
      ? path.resolve(configDir, override)
      : env
        ? path.resolve(env)
        : opts.outputFolder
          ? path.resolve(configDir, opts.outputFolder)
          : defaultHtmlFolder(configDir);
  const rel = path.relative(outputFolder, folder).split(path.sep).join('/') || '.';
  return {
    path: rel,
    attachmentsBaseURL: process.env.PLAYWRIGHT_HTML_ATTACHMENTS_BASE_URL || opts.attachmentsBaseURL || 'data/',
  };
}
