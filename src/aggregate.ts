import type { TestCoverageData } from './types';

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
  boxes: ScreenshotBox[];
}

export interface RouteCoverage {
  route: string;
  total: number;
  tested: number;
  percent: number;
  /** Untested elements that failing tests touched. */
  failingOnly: number;
  elements: ElementCoverage[];
  screenshots: RouteScreenshot[];
}

export interface CoverageSummary {
  generatedAt: string;
  total: number;
  tested: number;
  percent: number;
  failingOnly: number;
  routes: RouteCoverage[];
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
    elements: Map<string, ElementCoverage & { testedBySet: Set<string>; failingSet: Set<string> }>;
    snapshots: { snap: TestCoverageData['snapshots'][number]; test: string }[];
  };
  const routes = new Map<string, RouteAcc>();
  const routeFor = (url: string) => {
    const r = opts.normalizeUrl(url);
    if (!routes.has(r)) routes.set(r, { elements: new Map(), snapshots: [] });
    return routes.get(r)!;
  };

  // Pass 1: inventories.
  for (const { title, data } of tests) {
    for (const snap of data.snapshots) {
      const acc = routeFor(snap.url);
      acc.snapshots.push({ snap, test: title });
      const counts = new Map<string, number>();
      for (const el of snap.elements) counts.set(el.key, (counts.get(el.key) ?? 0) + 1);
      for (const el of snap.elements) {
        const existing = acc.elements.get(el.key);
        const n = counts.get(el.key)!;
        if (existing) existing.instances = Math.max(existing.instances, n);
        else
          acc.elements.set(el.key, {
            key: el.key,
            label: el.label,
            tag: el.tag,
            instances: n,
            tested: false,
            testedBy: [],
            testedByFailing: [],
            testedBySet: new Set(),
            failingSet: new Set(),
          });
      }
    }
  }

  // Pass 2: interactions.
  for (const { title, data, interactions: use = 'tested' } of tests) {
    if (use === 'ignore') continue;
    for (const i of data.interactions) {
      const acc = routeFor(i.url);
      let el = acc.elements.get(i.key);
      if (!el) {
        // Interacted with but never captured in an inventory (transient element).
        el = {
          key: i.key, label: i.label, tag: '?', instances: 1, tested: false,
          testedBy: [], testedByFailing: [], testedBySet: new Set(), failingSet: new Set(),
        };
        acc.elements.set(i.key, el);
      }
      if (use === 'failing') {
        el.failingSet.add(title);
      } else {
        el.tested = true;
        el.testedBySet.add(title);
      }
    }
  }

  const result: RouteCoverage[] = [];
  for (const [route, acc] of routes) {
    const elements = [...acc.elements.values()].map(({ testedBySet, failingSet, ...e }) => ({
      ...e,
      testedBy: [...testedBySet],
      testedByFailing: [...failingSet].filter((t) => !testedBySet.has(t)),
    }));
    if (elements.length === 0) continue;

    // Greedy set cover: pick screenshots that show the most not-yet-shown elements.
    const chosen: RouteScreenshot[] = [];
    const shown = new Set<string>();
    const candidates = acc.snapshots.filter((c) => c.snap.screenshot);
    while (chosen.length < opts.maxScreenshotsPerRoute && candidates.length) {
      let best = -1;
      let bestGain = 0;
      candidates.forEach((c, idx) => {
        const gain = new Set(c.snap.elements.map((e) => e.key).filter((k) => !shown.has(k))).size;
        if (gain > bestGain) {
          bestGain = gain;
          best = idx;
        }
      });
      if (best < 0) break;
      const [{ snap, test }] = candidates.splice(best, 1);
      snap.elements.forEach((e) => shown.add(e.key));
      chosen.push({
        source: snap.screenshot!,
        dpr: snap.dpr,
        test,
        boxes: snap.elements.map(({ key, x, y, w, h }) => ({ key, x, y, w, h })),
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
