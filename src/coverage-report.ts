/**
 * The public, versioned format of `coverage.json` (see docs/coverage-json.md
 * and schema/coverage.schema.json).
 *
 * Compatibility: `schemaVersion` changes only on breaking changes (a field
 * removed, renamed or given a different meaning). New fields can be added
 * without a version change, so readers must ignore fields they don't know.
 *
 * The report pipeline works on its own internal model (`CoverageSummary` in
 * aggregate.ts, also what index.html is rendered from); `toCoverageReport`
 * maps it to this format. Keep this file, the JSON Schema and the docs in sync:
 * test/coverage-schema.test.mjs checks the schema against these types.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {
  CoverageSummary,
  ElementCoverage as InternalElement,
  LinkCoverage as InternalLink,
  RouteCoverage,
  UntestedView as InternalUntestedView,
} from './aggregate';
import type { HtmlReportLink, TestInfo } from './insights';
import type { ThresholdResult } from './thresholds';

/** Current `coverage.json` schema version. */
export const COVERAGE_SCHEMA_VERSION = 1;

/**
 * Coverage counts, for the whole run (`CoverageReport.summary`) or one view
 * (`ViewCoverage.summary`).
 *
 * The denominator of `coverage` is every coverage unit: interactive elements
 * plus link units, `testedElementsCount + untestedElementsCount +
 * testedLinksCount + untestedLinksCount`. An `<a>` that is part of a link unit
 * (`ViewCoverage.links`) is not also counted as an element.
 */
export interface CoverageCounts {
  /**
   * Percent of units tested, 0–100, rounded to one decimal. 100 when there are
   * no units.
   */
  coverage: number;
  /** Interactive elements that a counted test interacted with. */
  testedElementsCount: number;
  /** Interactive elements no counted test interacted with (includes `failingOnlyElementsCount`). */
  untestedElementsCount: number;
  /** Link units (`ViewCoverage.links`) whose destination view a counted test visited. */
  testedLinksCount: number;
  /** Link units whose destination view no counted test visited. */
  untestedLinksCount: number;
  /**
   * Untested elements that only attempts that didn't pass interacted with
   * (they don't count unless `countFailedTests` is set).
   */
  failingOnlyElementsCount: number;
  /** Accessibility hints on these elements. Informational: never affects `coverage`. */
  a11yHintsCount: number;
}

/** Overall counts. */
export interface ReportSummary extends CoverageCounts {
  /** Number of views (entries in `views`). */
  viewCount: number;
  /** Number of entries in `untestedViews`. */
  untestedViewCount: number;
}

/** One view: a normalized URL (`/users/:id`) or, for component tests, a spec file. */
export interface ViewCoverage {
  /** View name as shown in the report and used in `threshold.views`. */
  name: string;
  /**
   * This view in the HTML report, relative to the folder of coverage.json
   * (`index.html#` + `encodeURIComponent(name)`).
   */
  reportUrl: string;
  summary: CoverageCounts;
  /** Interactive elements (not the `<a>` elements of `links`). Untested first, then by label. */
  elements: ElementCoverage[];
  /** Link units: this view's links grouped by destination view. Untested first, then by key. */
  links: LinkCoverage[];
  /**
   * Screenshots shown in the HTML report, with element boxes. Internal:
   * which screenshots are picked depends on timing, and the shape may change
   * without a schema version change.
   */
  screenshots: ViewScreenshot[];
}

/**
 * One interactive element of a view. `(view name, key)` identifies it across
 * runs, as long as the identity rules don't change.
 */
export interface ElementCoverage {
  /**
   * Identity: a structural selector, unique within the view. Inside an iframe
   * or open shadow root, prefixed by the host's key and ` >> `
   * (`iframe[data-testid="pay"] >> #card`, `my-widget >> button`).
   */
  key: string;
  /** Human-readable `role "name"`; `(+N variants)` when instances sharing the key had different labels. */
  label: string;
  /** Lowercase tag name; `?` for an element seen only in an interaction, never in an inventory. */
  tag: string;
  /** Max number of instances seen at once (e.g. a "Delete" button per row). */
  instances: number;
  tested: boolean;
  /** Ids (see `CoverageReport.tests`) of the tests whose interactions counted. */
  testIds: string[];
  /**
   * Ids of tests that interacted with it only in attempts that didn't pass.
   * Non-empty with `tested: false` means "touched by failing tests only".
   */
  failingTestIds: string[];
  /** Counted interactions by type, e.g. `{ "click": 3, "input": 1 }`. Empty when untested. */
  interactionCounts: Record<string, number>;
  /** Recorded ARIA role (explicit or implicit). */
  role?: string;
  /** Recorded accessible name (approximation of the browser's). */
  name?: string;
  /** Where `name` came from: `aria-labelledby`, `aria-label`, `label`, `placeholder`, `title`, `alt`, `value`, `text` or `name`. */
  nameFrom?: string;
  /** Identifying attributes (id, name, role, type, aria-label, href, data-*, …). */
  attrs?: Record<string, string>;
  /** Keys of the `<iframe>` elements the element is inside, outermost first (each a prefix of `key`). Absent in the top document. */
  frames?: string[];
  /** One line of Playwright code that interacts with the element. Heuristic: the text may change between versions. */
  suggestedLocator?: string;
  /** Informational accessibility hints; absent when there are none. Messages may change between versions. */
  a11yHints?: A11yHint[];
}

/**
 * The links of a view that go to one other view: one coverage unit, tested
 * when a counted test visited that view (by any path, not necessarily through
 * these links). `(view name, key)` identifies it across runs.
 */
export interface LinkCoverage {
  /** The destination view's name. Unique within the view. */
  key: string;
  /** `link "name"` of the first referrer, `(+N more)` when several links go there. */
  label: string;
  tested: boolean;
  /** Distinct destination URLs, sorted, at most 20: path, query and hash on the page's origin, else the full URL. */
  destinations: string[];
  /** Number of distinct destination URLs (may exceed `destinations.length`). */
  destinationCount: number;
  /**
   * The `<a>` elements of this view that link there. Their `tested` means a
   * test interacted with them (informational: it doesn't affect coverage).
   */
  referrers: ElementCoverage[];
}

/** A view that links point to but no counted test visited. */
export interface UntestedView {
  /** View name (from the destination URL, the same way page URLs are named). */
  name: string;
  /** Distinct destination URLs, sorted, at most 20. */
  destinations: string[];
  /** Number of distinct destination URLs. */
  destinationCount: number;
  /** The views that link to it, by name. */
  referrers: UntestedViewReferrer[];
}

/** A view linking to an untested view. */
export interface UntestedViewReferrer {
  /** Name of the linking view (in `views`). */
  view: string;
  /** Label of its link unit (`ViewCoverage.links[].label`). */
  label: string;
  /** Keys of the `<a>` elements (`ViewCoverage.links[].referrers[].key`). */
  keys: string[];
}

export interface A11yHint {
  /**
   * Rule id: `no-name`, `placeholder-only`, `duplicate-name`, `not-focusable`
   * or `no-role`. More rules may be added: treat unknown ids as generic hints.
   */
  rule: string;
  message: string;
}

export interface ViewScreenshot {
  /** Image file, relative to the folder of coverage.json (`screens/0.png`). */
  file: string;
  /** Device pixel ratio: box coordinates are CSS pixels, the image is `dpr` times larger. */
  dpr: number;
  /** Id of the test that took it. */
  testId?: string;
  boxes: { key: string; x: number; y: number; w: number; h: number }[];
}

/** A test that contributed data. */
export interface TestRef {
  /** `TestCase.id`: stable across runs for the same file, title and project. */
  id: string;
  /** Spec file and title path, e.g. `users.spec.ts › add a user`. */
  title: string;
  /** Playwright project name, when set. */
  project?: string;
  /** Whether the attempt the report used passed (has the expected status). */
  passed: boolean;
  /** `TestResult.retry` of that attempt (the last passing one, else the last one). */
  retry: number;
  /** That attempt's trace file inside the Playwright HTML report's attachments folder, when linked. */
  trace?: string;
}

/** A configured threshold and whether it was met. */
export interface ThresholdCheck {
  /** `overall`, or a view (`view` is its name). */
  scope: 'overall' | 'view';
  /** View name; for a pattern that matched no view, the pattern. */
  view?: string;
  /** The `threshold.views` glob that set this requirement, when it was a pattern. */
  pattern?: string;
  /** Required `coverage` percent. */
  required: number;
  /** Actual `coverage` percent; `null` when the view wasn't seen in this run. */
  actual: number | null;
  /** `missing` (view not seen) only warns and doesn't fail the run. */
  status: 'passed' | 'failed' | 'missing';
}

/** An element used by several tests (often a repeated setup step). */
export interface RepeatedElement {
  view: string;
  key: string;
  label: string;
  /** Distinct tests whose interactions counted. */
  testCount: number;
  /** Counted interactions, all types. */
  interactionCount: number;
  /** `testCount` as a percent of all tests in `tests`. */
  testShare: number;
}

/** The whole `coverage.json`. */
export interface CoverageReport {
  /** Bumped only on breaking changes. */
  schemaVersion: typeof COVERAGE_SCHEMA_VERSION;
  /** ISO 8601 time the report was built. */
  generatedAt: string;
  generator: { name: 'playwright-ui-coverage'; version: string };
  summary: ReportSummary;
  /** Sorted by name. */
  views: ViewCoverage[];
  /** Destination views of untested links that no recorded test visited, sorted by name. */
  untestedViews: UntestedView[];
  /** Every test with recorded data, by title. */
  tests: TestRef[];
  /** Empty when no `threshold` is configured. */
  thresholds: ThresholdCheck[];
  insights: {
    /** Up to 10 elements used by at least 2 tests, most first. */
    mostRepeated: RepeatedElement[];
  };
  /** Playwright's HTML report, when linked: where `tests[].trace` files are. */
  playwrightReport?: {
    /** Folder, relative to the folder of coverage.json (`/` separators). */
    path: string;
    /** Its `attachmentsBaseURL`, relative to `path`. */
    attachmentsBaseURL: string;
  };
  /** The UI coverage config that built the report. */
  config?: ReportConfig;
  /** Result of the `baseline` option; absent when it isn't set (or is `mode: 'off'`). */
  baseline?: BaselineCheck;
}

/**
 * The baseline check (`baseline` reporter option): untested units compared
 * with a committed baseline file. Only a *new gap* (an untested unit the
 * baseline doesn't list) fails the run.
 */
export interface BaselineCheck {
  /** Baseline file, relative to the folder of coverage.json (`/` separators). */
  file: string;
  mode: 'check' | 'update';
  /**
   * `failed`: there are `newGaps`. `missing`: no baseline file yet (only warns).
   * `updated`: `mode: 'update'` rewrote the file (never fails).
   */
  status: 'passed' | 'failed' | 'missing' | 'updated';
  /** The current state, written in check mode (`<file>` with `.next.json`), relative like `file`. */
  nextFile?: string;
  /** Whether untested units of views the baseline doesn't have are allowed. */
  allowNewViews: boolean;
  /** Untested units not in the baseline, by view then key. In update mode: what was added to the file. */
  newGaps: BaselineGap[];
  /** Units the baseline lists as untested that are now tested or gone. */
  resolved: BaselineResolved[];
  /** Views in this run but not in the baseline (not counting renames). */
  addedViews: string[];
  /** Views in the baseline but not in this run (not counting renames). Never fail the run. */
  removedViews: string[];
  /** Views that look renamed (similar untested keys), compared with their old baseline entry. */
  renamedViews: ViewRename[];
}

/** An untested unit the baseline doesn't list. */
export interface BaselineGap {
  view: string;
  kind: 'element' | 'link';
  key: string;
  label: string;
  /** True when the whole view is new (not in the baseline). */
  newView: boolean;
}

/** A unit the baseline lists as untested that isn't any more. */
export interface BaselineResolved {
  view: string;
  kind: 'element' | 'link';
  key: string;
  /** `tested`: now tested. `removed`: no longer in the view. */
  reason: 'tested' | 'removed';
  /** Present for `tested`. */
  label?: string;
}

/** A view that disappeared and one that appeared with similar keys. */
export interface ViewRename {
  from: string;
  to: string;
}

/**
 * Where the config of a report came from, written to `coverage.json` (and the
 * data folder) for traceability.
 */
export interface ReportConfig {
  source: {
    /** The config file, relative to the working directory (`/` separators); `null` without one. */
    file: string | null;
    /** Top-level keys set in the reporter options (they win over the file). */
    inline: string[];
  };
  /** The selected profile, or `null`. */
  profile: string | null;
  /**
   * The resolved config: the file, the reporter options and the profile,
   * merged (without `profiles`). Functions appear as `"[function name]"`.
   * `recording` is what the config sets; `use.uiCoverage` can override it per project.
   */
  resolved: Record<string, unknown>;
}

let cachedVersion: string | undefined;
function packageVersion(): string {
  if (cachedVersion === undefined) {
    try {
      cachedVersion = String(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version);
    } catch {
      cachedVersion = '0.0.0';
    }
  }
  return cachedVersion;
}

const percent = (tested: number, total: number) => (total === 0 ? 100 : Math.round((tested / total) * 1000) / 10);

function counts(
  r: Pick<RouteCoverage, 'total' | 'tested' | 'failingOnly' | 'a11yHints'> & Partial<Pick<RouteCoverage, 'totalLinks' | 'testedLinks'>>,
): CoverageCounts {
  const totalLinks = r.totalLinks ?? 0;
  const testedLinks = r.testedLinks ?? 0;
  return {
    coverage: percent(r.tested, r.total),
    testedElementsCount: r.tested - testedLinks,
    untestedElementsCount: r.total - totalLinks - (r.tested - testedLinks),
    testedLinksCount: testedLinks,
    untestedLinksCount: totalLinks - testedLinks,
    failingOnlyElementsCount: r.failingOnly,
    a11yHintsCount: r.a11yHints ?? 0,
  };
}

/** Test ids when recorded, else titles (only for data aggregated without ids). */
const ids = (list: string[] | undefined, fallback: string[]) => [...(list ?? fallback)];

function element(e: InternalElement): ElementCoverage {
  const out: ElementCoverage = {
    key: e.key,
    label: e.label,
    tag: e.tag,
    instances: e.instances,
    tested: e.tested,
    testIds: ids(e.testIds, e.testedBy),
    failingTestIds: ids(e.failingTestIds, e.testedByFailing),
    interactionCounts: { ...e.interactionCounts },
  };
  if (e.role !== undefined) out.role = e.role;
  if (e.name !== undefined) out.name = e.name;
  if (e.nameFrom !== undefined) out.nameFrom = e.nameFrom;
  if (e.attrs !== undefined) out.attrs = e.attrs;
  if (e.frames?.length) out.frames = [...e.frames];
  if (e.suggestedLocator !== undefined) out.suggestedLocator = e.suggestedLocator;
  if (e.a11yHints?.length) out.a11yHints = e.a11yHints.map(({ rule, message }) => ({ rule, message }));
  return out;
}

const link = (l: InternalLink): LinkCoverage => ({
  key: l.key,
  label: l.label,
  tested: l.tested,
  destinations: [...l.destinations],
  destinationCount: l.destinationCount,
  referrers: l.referrers.map(element),
});

const untestedView = (v: InternalUntestedView): UntestedView => ({
  name: v.view,
  destinations: [...v.destinations],
  destinationCount: v.destinationCount,
  referrers: v.referrers.map((r) => ({ view: r.route, label: r.label, keys: [...r.keys] })),
});

const threshold = (t: ThresholdResult): ThresholdCheck => ({
  scope: t.scope,
  ...(t.scope === 'view' ? { view: t.target } : {}),
  ...(t.pattern ? { pattern: t.pattern } : {}),
  required: t.required,
  actual: t.actual,
  status: t.status,
});

const test = (t: TestInfo): TestRef => ({
  id: t.id,
  title: t.title,
  ...(t.project !== undefined ? { project: t.project } : {}),
  passed: t.passed,
  retry: t.run,
  ...(t.trace !== undefined ? { trace: t.trace } : {}),
});

/**
 * Maps the internal summary (after screenshots were copied to `screens/`) to
 * the public `coverage.json` format.
 */
export function toCoverageReport(
  summary: CoverageSummary,
  thresholds: ThresholdResult[],
  config?: ReportConfig,
): CoverageReport {
  const htmlReport: HtmlReportLink | undefined = summary.htmlReport;
  const untestedViews = (summary.untestedViews ?? []).map(untestedView);
  return {
    schemaVersion: COVERAGE_SCHEMA_VERSION,
    generatedAt: summary.generatedAt,
    generator: { name: 'playwright-ui-coverage', version: packageVersion() },
    summary: { viewCount: summary.routes.length, untestedViewCount: untestedViews.length, ...counts(summary) },
    views: summary.routes.map((r) => ({
      name: r.route,
      reportUrl: `index.html#${encodeURIComponent(r.route)}`,
      summary: counts(r),
      elements: r.elements.map(element),
      links: (r.links ?? []).map(link),
      screenshots: r.screenshots.map((s) => ({
        file: s.source,
        dpr: s.dpr,
        ...(s.testId !== undefined ? { testId: s.testId } : {}),
        boxes: s.boxes.map(({ key, x, y, w, h }) => ({ key, x, y, w, h })),
      })),
    })),
    untestedViews,
    tests: (summary.tests ?? []).map(test),
    thresholds: thresholds.map(threshold),
    insights: {
      mostRepeated: (summary.mostRepeated ?? []).map((m) => ({
        view: m.route,
        key: m.key,
        label: m.label,
        testCount: m.tests,
        interactionCount: m.interactions,
        testShare: m.share,
      })),
    },
    ...(htmlReport ? { playwrightReport: { path: htmlReport.path, attachmentsBaseURL: htmlReport.attachmentsBaseURL } } : {}),
    ...(config ? { config } : {}),
  };
}
