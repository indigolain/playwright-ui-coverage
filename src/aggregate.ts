import type { HtmlReportLink, RepeatedElement, TestInfo } from './insights';
import type { A11yHint } from './a11y';
import type { InventoryElement, TestCoverageData } from './types';

/** Recorded role, accessible name and attributes of an element (see `InventoryElement`). */
type ElementDetails = Pick<InventoryElement, 'role' | 'name' | 'nameFrom' | 'attrs'>;
const details = (e: ElementDetails): ElementDetails => ({ role: e.role, name: e.name, nameFrom: e.nameFrom, attrs: e.attrs });

export interface ElementCoverage {
  key: string;
  label: string;
  tag: string;
  /** Max number of instances seen at once (e.g. a "Delete" button per row). */
  instances: number;
  tested: boolean;
  testedBy: string[];
  /**
   * Tests that touched this element only in attempts that didn't pass (and so
   * don't count). Non-empty with `tested: false` means "touched by failing tests only".
   */
  testedByFailing: string[];
  /**
   * Interactions that counted as tested, by event type (e.g. `{ click: 3, input: 1 }`).
   * Empty for untested elements.
   */
  interactionCounts: Record<string, number>;
  /** Sum of `interactionCounts`. */
  interactionTotal?: number;
  /** Distinct tests whose interactions counted (by test id when known, else by title). */
  testCount?: number;
  /** `TestCase.id`s of the tests in `testedBy`; see `CoverageSummary.tests`. */
  testIds?: string[];
  /** `TestCase.id`s of the tests in `testedByFailing`. */
  failingTestIds?: string[];
  /** Recorded role, accessible name, its source and raw attributes, of the variant `label` shows. */
  role?: string;
  name?: string;
  nameFrom?: string;
  attrs?: Record<string, string>;
  /** A Playwright line that interacts with this element (see `locators.ts`). */
  suggestedLocator?: string;
  /** Informational accessibility hints (see `a11y.ts`). Don't affect coverage. */
  a11yHints?: A11yHint[];
}

export interface ScreenshotBox {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RouteScreenshot {
  source: string;
  dpr: number;
  test: string;
  /** `TestCase.id` of `test`, when known. */
  testId?: string;
  boxes: ScreenshotBox[];
}

export interface RouteCoverage {
  route: string;
  total: number;
  tested: number;
  percent: number;
  /** Untested elements that failing tests touched. */
  failingOnly: number;
  /** Number of accessibility hints on this route's elements. */
  a11yHints?: number;
  elements: ElementCoverage[];
  screenshots: RouteScreenshot[];
}

export interface CoverageSummary {
  generatedAt: string;
  total: number;
  tested: number;
  percent: number;
  failingOnly: number;
  /** Total accessibility hints across routes. */
  a11yHints?: number;
  routes: RouteCoverage[];
  /** Every test, with what's needed to link to it in Playwright's HTML report. Set by the reporter. */
  tests?: TestInfo[];
  /** Playwright's HTML report, when configured. Set by the reporter. */
  htmlReport?: HtmlReportLink;
  /** Elements used by the most tests. Set by the reporter. */
  mostRepeated?: RepeatedElement[];
}

export type NormalizeUrl = (url: string) => string;

const ID_SEGMENT = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,})$/i;

/** `/users/42?tab=x` → `/users/:id`. Hash routes (`#/foo/1`) are kept and normalized too. */
export const defaultNormalizeUrl: NormalizeUrl = (url) => {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const norm = (p: string) =>
    p
      .split('/')
      .map((seg) => (ID_SEGMENT.test(seg) ? ':id' : seg))
      .join('/')
      .replace(/\/index\.html?$/, '/');
  let route = norm(u.pathname) || '/';
  if (u.hash.startsWith('#/')) route += '#' + norm(u.hash.slice(1).split('?')[0]);
  return route;
};

/**
 * How an entry's interactions count: `tested` marks elements tested, `failing`
 * only records them in `testedByFailing`, `ignore` drops them. Inventories always count.
 */
export type InteractionUse = 'tested' | 'failing' | 'ignore';

export interface TestEntry {
  title: string;
  /** `TestCase.id`; when set, elements list it in `testIds` / `failingTestIds`. */
  testId?: string;
  data: TestCoverageData;
  /** Default: `tested`. */
  interactions?: InteractionUse;
}

const percent = (tested: number, total: number) =>
  total === 0 ? 100 : Math.round((tested / total) * 1000) / 10;

export function aggregate(
  tests: TestEntry[],
  opts: { normalizeUrl: NormalizeUrl; maxScreenshotsPerRoute: number },
): CoverageSummary {
  type RouteAcc = {
    elements: Map<string, ElementCoverage & { testedBySet: Set<string>; failingSet: Set<string>; labels: Map<string, ElementDetails>; idSet: Set<string>; failingIdSet: Set<string> }>;
    snapshots: { snap: TestCoverageData['snapshots'][number]; test: string; testId?: string }[];
  };
  const routes = new Map<string, RouteAcc>();
  /** `view` (set for `viewBy: 'file'`) puts all of an entry's data in one view, whatever the URL. */
  const routeFor = (url: string, view?: string) => {
    const r = view ?? opts.normalizeUrl(url);
    if (!routes.has(r)) routes.set(r, { elements: new Map(), snapshots: [] });
    return routes.get(r)!;
  };

  // Pass 1: inventories.
  for (const { title, testId, data } of tests) {
    for (const snap of data.snapshots) {
      const acc = routeFor(snap.url, data.view);
      acc.snapshots.push({ snap, test: title, testId });
      const counts = new Map<string, number>();
      for (const el of snap.elements) counts.set(el.key, (counts.get(el.key) ?? 0) + 1);
      for (const el of snap.elements) {
        const existing = acc.elements.get(el.key);
        const n = counts.get(el.key)!;
        if (existing) {
          existing.instances = Math.max(existing.instances, n);
          if (!existing.labels.has(el.label)) existing.labels.set(el.label, details(el));
        } else
          acc.elements.set(el.key, {
            key: el.key,
            label: el.label,
            tag: el.tag,
            instances: n,
            tested: false,
            testedBy: [],
            testedByFailing: [],
            interactionCounts: {},
            testedBySet: new Set(),
            failingSet: new Set(),
            labels: new Map([[el.label, details(el)]]),
            idSet: new Set(),
            failingIdSet: new Set(),
          });
      }
    }
  }

  // Pass 2: interactions.
  for (const { title, testId, data, interactions: use = 'tested' } of tests) {
    if (use === 'ignore') continue;
    for (const i of data.interactions) {
      const acc = routeFor(i.url, data.view);
      let el = acc.elements.get(i.key);
      if (!el) {
        // Interacted with but never captured in an inventory (transient element).
        el = {
          key: i.key, label: i.label, tag: '?', instances: 1, tested: false,
          testedBy: [], testedByFailing: [], interactionCounts: {}, testedBySet: new Set(), failingSet: new Set(), labels: new Map([[i.label, details(i)]]),
          idSet: new Set(), failingIdSet: new Set(),
        };
        acc.elements.set(i.key, el);
      }
      if (use === 'failing') {
        el.failingSet.add(title);
        if (testId) el.failingIdSet.add(testId);
      } else {
        el.tested = true;
        el.testedBySet.add(title);
        if (testId) el.idSet.add(testId);
        el.interactionCounts[i.event] = (el.interactionCounts[i.event] ?? 0) + 1;
      }
    }
  }

  const result: RouteCoverage[] = [];
  for (const [route, acc] of routes) {
    const withIds = tests.some((t) => t.testId);
    const elements = [...acc.elements.values()].map(({ testedBySet, failingSet, labels, idSet, failingIdSet, ...e }) => {
      // Elements sharing a key (e.g. a link on every table row) can have different
      // labels; pick one independent of test order so reports are reproducible.
      const sorted = [...labels.keys()].sort();
      return {
        ...e,
        ...labels.get(sorted[0]),
        label: sorted.length > 1 ? `${sorted[0]} (+${sorted.length - 1} variants)` : sorted[0],
        testedBy: [...testedBySet].sort(),
        testedByFailing: [...failingSet].filter((t) => !testedBySet.has(t)).sort(),
        // Sorted by type so the JSON doesn't depend on test order.
        interactionCounts: Object.fromEntries(
          Object.entries(e.interactionCounts).sort(([a], [b]) => a.localeCompare(b)),
        ),
        interactionTotal: Object.values(e.interactionCounts).reduce((s, n) => s + n, 0),
        testCount: withIds ? idSet.size : testedBySet.size,
        ...(withIds
          ? { testIds: [...idSet].sort(), failingTestIds: [...failingIdSet].filter((t) => !idSet.has(t)).sort() }
          : {}),
      };
    });
    if (elements.length === 0) continue;

    // Elements actually in the image (a cropped screenshot hides those below its height).
    const visible = (snap: TestCoverageData['snapshots'][number]) =>
      snap.screenshotHeight ? snap.elements.filter((e) => e.y < snap.screenshotHeight!) : snap.elements;
    // Greedy set cover: pick screenshots that show the most not-yet-shown elements.
    const chosen: RouteScreenshot[] = [];
    const shown = new Set<string>();
    const candidates = acc.snapshots.filter((c) => c.snap.screenshot);
    while (chosen.length < opts.maxScreenshotsPerRoute && candidates.length) {
      let best = -1;
      let bestGain = 0;
      candidates.forEach((c, idx) => {
        const gain = new Set(visible(c.snap).map((e) => e.key).filter((k) => !shown.has(k))).size;
        if (gain > bestGain) {
          bestGain = gain;
          best = idx;
        }
      });
      if (best < 0) break;
      const [{ snap, test, testId }] = candidates.splice(best, 1);
      const inImage = visible(snap);
      inImage.forEach((e) => shown.add(e.key));
      chosen.push({
        source: snap.screenshot!,
        dpr: snap.dpr,
        test,
        ...(testId ? { testId } : {}),
        boxes: inImage.map(({ key, x, y, w, h }) => ({ key, x, y, w, h })),
      });
    }

    const tested = elements.filter((e) => e.tested).length;
    const failingOnly = elements.filter((e) => !e.tested && e.testedByFailing.length > 0).length;
    elements.sort((a, b) => Number(a.tested) - Number(b.tested) || a.label.localeCompare(b.label));
    result.push({
      route,
      total: elements.length,
      tested,
      percent: percent(tested, elements.length),
      failingOnly,
      elements,
      screenshots: chosen,
    });
  }

  result.sort((a, b) => a.route.localeCompare(b.route));
  const total = result.reduce((s, r) => s + r.total, 0);
  const tested = result.reduce((s, r) => s + r.tested, 0);
  const failingOnly = result.reduce((s, r) => s + r.failingOnly, 0);
  return {
    generatedAt: new Date().toISOString(),
    total,
    tested,
    percent: percent(tested, total),
    failingOnly,
    routes: result,
  };
}
