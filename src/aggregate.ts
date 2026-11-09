import type { HtmlReportLink, RepeatedElement, TestInfo } from './insights';
import type { A11yHint } from './a11y';
import type { LinkRules, UiCoverageRules } from './model/rules';
import type { InventoryElement, TestCoverageData } from './types';
import { boxInImage, intersects } from './model/geometry';
import { applyGrouping, type ElementGroup } from './grouping';
import {
  firstSteps,
  groupAttempts,
  routeStates,
  walkSteps,
  type AttemptSummary,
  type RouteState,
  type StateCandidate,
  type StateRef,
} from './steps';
import type { Snapshot } from './types';

/** Recorded role, accessible name and attributes of an element (see `InventoryElement`). */
type ElementDetails = Pick<InventoryElement, 'role' | 'name' | 'nameFrom' | 'attrs' | 'frames' | 'autoKey'>;
const details = (e: ElementDetails): ElementDetails => ({
  role: e.role,
  name: e.name,
  nameFrom: e.nameFrom,
  attrs: e.attrs,
  ...(e.frames ? { frames: e.frames } : {}),
  ...(e.autoKey ? { autoKey: e.autoKey } : {}),
});

export interface ElementCoverage {
  key: string;
  label: string;
  tag: string;
  /** Max number of instances seen at once (e.g. a "Delete" button per row). */
  instances: number;
  /**
   * Set when this element stands for several: a group (docs "Element
   * grouping") or instances sharing a key. Absent for a single element.
   */
  group?: ElementGroup;
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
  /** Keys of the `<iframe>` elements the element is inside, outermost first (see `InventoryElement.frames`). */
  frames?: string[];
  /** Set for an element named by an `elements` rule: its key by the identity rules (for locators). */
  autoKey?: string;
  /** A Playwright line that interacts with this element (see `locators.ts`). */
  suggestedLocator?: string;
  /** Informational accessibility hints (see `a11y.ts`). Don't affect coverage. */
  a11yHints?: A11yHint[];
  /**
   * Per test id in `testIds`: the index of the first step of that test's
   * counted attempt that acted on this element (the walkthrough). Not in coverage.json.
   */
  firstStep?: Record<string, number>;
}

export interface ScreenshotBox {
  key: string;
  /** In image CSS pixels: document coordinates, or relative to the clip of a viewport screenshot. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** `position: fixed` / `sticky` (itself or an ancestor). */
  pos?: 'fixed' | 'sticky';
}

export interface RouteScreenshot {
  source: string;
  dpr: number;
  test: string;
  /** `TestCase.id` of `test`, when known. */
  testId?: string;
  /** A viewport screenshot of a short-lived state (`captureTransientStates`), not the full page. */
  viewport?: true;
  boxes: ScreenshotBox[];
}

/**
 * A link unit: the links of one view that go to one other view. Tested when a
 * counted test visited the destination view (by any path, not necessarily
 * through these links).
 */
export interface LinkCoverage {
  /** The destination view. Unique within the source view. */
  key: string;
  /** `link "name"` of the first referrer by label, `(+N more)` when there are several. */
  label: string;
  tested: boolean;
  /** Distinct destination URLs (origin-relative when on the page's origin), sorted, at most `MAX_DESTINATIONS`. */
  destinations: string[];
  /** Number of distinct destination URLs (can exceed `destinations.length`). */
  destinationCount: number;
  /**
   * The `<a>` elements of the source view that link there. Their `tested`
   * means a test interacted with them; it doesn't affect coverage.
   */
  referrers: ElementCoverage[];
}

/** A view that links point to but that no counted test visited. */
export interface UntestedView {
  view: string;
  destinations: string[];
  destinationCount: number;
  /** Source views and the link unit there (`label`, referrer keys). */
  referrers: { route: string; label: string; keys: string[] }[];
}

/** Destination URLs kept per link unit or untested view. */
export const MAX_DESTINATIONS = 20;

export interface RouteCoverage {
  route: string;
  /** Coverage units: interactive elements plus link units. */
  total: number;
  tested: number;
  percent: number;
  /** Link units (part of `total` / `tested`). */
  totalLinks: number;
  testedLinks: number;
  /** Untested elements that failing tests touched. */
  failingOnly: number;
  /** Number of accessibility hints on this route's elements. */
  a11yHints?: number;
  elements: ElementCoverage[];
  /** Untested first, then by destination view. */
  links: LinkCoverage[];
  screenshots: RouteScreenshot[];
  /**
   * Every distinct screenshot of the view, from every attempt, in the order
   * they were first reached (the report's state stepper). Not in coverage.json.
   */
  states?: RouteState[];
}

export interface CoverageSummary {
  generatedAt: string;
  /** Coverage units of every route: interactive elements plus link units. */
  total: number;
  tested: number;
  percent: number;
  totalLinks: number;
  testedLinks: number;
  failingOnly: number;
  /** Total accessibility hints across routes. */
  a11yHints?: number;
  routes: RouteCoverage[];
  /** Destination views of links that no counted test visited, by name. */
  untestedViews: UntestedView[];
  /** Every test, with what's needed to link to it in Playwright's HTML report. Set by the reporter. */
  tests?: TestInfo[];
  /** Playwright's HTML report, when configured. Set by the reporter. */
  htmlReport?: HtmlReportLink;
  /** Elements used by the most tests. Set by the reporter. */
  mostRepeated?: RepeatedElement[];
  /** Every test attempt (one per test and retry), which `RouteState.attempts` point into. */
  attempts?: AttemptSummary[];
}

export { defaultNormalizeUrl, type NormalizeUrl } from './model/views';
import { defaultNormalizeUrl, type NormalizeUrl, type ViewMapper } from './model/views';

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
  /** The attempt the data is from (`TestResult.retry`), whether it passed, and where its trace is. */
  retry?: number;
  passed?: boolean;
  project?: string;
  trace?: string;
}

const percent = (tested: number, total: number) =>
  total === 0 ? 100 : Math.round((tested / total) * 1000) / 10;

/** Elements of a route plus the `<a>` elements of its link units (each once). */
export function allElements(r: Pick<RouteCoverage, 'elements' | 'links'>): ElementCoverage[] {
  const out = new Set(r.elements);
  for (const l of r.links ?? []) for (const e of l.referrers) out.add(e);
  return [...out];
}

/** How a recorded `<a>` counts: a link unit to `view`, an interactive element, or not at all. */
export type LinkClass = { kind: 'link'; view: string; url: string } | { kind: 'element' } | { kind: 'ignore' };

/**
 * Classifies a recorded element on the page at `pageUrl` (whose view is
 * `sourceView`). `viewOf` maps a URL to its view, the same function page URLs
 * go through; returning `undefined` drops the link (for URLs excluded from
 * the report). `included` (the `viewFilters` predicate) drops links to
 * excluded URLs on other sites too. `internal` holds the origins of the visited pages.
 */
export function classifyLink(
  e: Pick<InventoryElement, 'tag' | 'attrs' | 'href' | 'frames'>,
  pageUrl: string,
  sourceView: string,
  ctx: {
    viewOf: (url: string) => string | undefined;
    included?: (url: string) => boolean;
    internal: Set<string>;
    rules: LinkRules;
  },
): LinkClass {
  const raw = e.attrs?.href;
  if ((e.tag !== 'a' && e.tag !== 'area') || raw === undefined) return { kind: 'element' };
  // A link in an iframe navigates the frame, whose document isn't a view.
  if (e.frames?.length) return { kind: 'element' };
  const href = raw.trim();
  if (!href || /^javascript:/i.test(href)) return { kind: 'element' };
  let page: URL;
  let dest: URL;
  try {
    page = new URL(pageUrl);
    dest = new URL(e.href ?? href, page);
  } catch {
    return { kind: 'element' };
  }
  if (dest.protocol !== page.protocol && !/^https?:$/.test(dest.protocol)) return { kind: 'element' };
  if (ctx.included && !ctx.included(dest.href)) return { kind: 'ignore' };
  if (dest.origin !== page.origin && !ctx.internal.has(dest.origin))
    return ctx.rules.external === 'ignore' ? { kind: 'ignore' } : { kind: 'element' };
  const view = ctx.viewOf(dest.href);
  if (view === undefined) return { kind: 'ignore' };
  // Fragment links (#x, #) and links to the page's own view don't lead anywhere new.
  if (view === sourceView) return { kind: 'element' };
  const url = dest.origin === page.origin ? dest.pathname + dest.search + dest.hash : dest.href;
  return { kind: 'link', view, url };
}

const originOf = (url: string) => {
  try {
    const o = new URL(url).origin;
    return o === 'null' ? undefined : o;
  } catch {
    return undefined;
  }
};

export function aggregate(
  tests: TestEntry[],
  opts: {
    /**
     * Maps page URLs and link destinations to views (`createViewMapper(options)`
     * in `model/views.ts`): `view(url) === null` drops the page, its
     * interactions and links to it; `included` drops links to excluded URLs.
     */
    viewMapper?: ViewMapper;
    /** Used when `viewMapper` isn't given. */
    normalizeUrl?: NormalizeUrl;
    maxScreenshotsPerRoute: number;
    links?: UiCoverageRules['links'];
  },
): CoverageSummary {
  type RouteAcc = {
    elements: Map<string, ElementCoverage & { testedBySet: Set<string>; failingSet: Set<string>; labels: Map<string, ElementDetails>; idSet: Set<string>; failingIdSet: Set<string> }>;
    snapshots: { snap: TestCoverageData['snapshots'][number]; test: string; testId?: string }[];
    /** Element key → how its instances classified; `links`: destination view → URLs. */
    kinds: Map<string, { element: boolean; links: Map<string, Set<string>> }>;
  };
  const routes = new Map<string, RouteAcc>();
  /**
   * The one function that maps a URL to its view, for page URLs and link
   * destinations alike. `undefined` drops the URL: the hook for filtering
   * views out of the report (pages and links to them).
   */
  const normalize = opts.normalizeUrl ?? defaultNormalizeUrl;
  const viewOf = (url: string): string | undefined =>
    opts.viewMapper ? (opts.viewMapper.view(url) ?? undefined) : normalize(url);
  const included = opts.viewMapper?.included;
  /** `view` (set for `viewBy: 'file'`) puts all of an entry's data in one view, whatever the URL. */
  const routeName = (url: string, view?: string) => view ?? viewOf(url);
  const grouping = applyGrouping(tests, routeName);
  tests = grouping.tests;
  const routeFor = (r: string) => {
    if (!routes.has(r)) routes.set(r, { elements: new Map(), snapshots: [], kinds: new Map() });
    return routes.get(r)!;
  };

  // Screenshots that are states of a view: every snapshot screenshot and step state, of every attempt.
  const { attempts, attemptOf } = groupAttempts(tests);
  /** Where each state screenshot ended up: its view and index there (for the walkthrough). */
  const stateRefs = new Map<Snapshot, StateRef>();
  const stateCandidates = new Map<string, StateCandidate[]>();
  let seq = 0;
  tests.forEach(({ data }, i) => {
    for (const snap of [...data.snapshots, ...(data.states ?? [])]) {
      if (!snap.screenshot) continue;
      const route = routeName(snap.url, data.view);
      if (route === undefined) continue;
      if (!stateCandidates.has(route)) stateCandidates.set(route, []);
      stateCandidates.get(route)!.push({ snap, attempt: attemptOf[i], seq: seq++ });
    }
  });

  // Views visited by counted tests (a link to them is tested), and the origins of every visited page.
  const visited = new Set<string>();
  const internal = new Set<string>();
  for (const { data, interactions: use = 'tested' } of tests) {
    for (const { url } of [...data.snapshots, ...data.interactions]) {
      const o = originOf(url);
      if (o) internal.add(o);
      if (use !== 'tested') continue;
      const r = routeName(url, data.view);
      if (r !== undefined) visited.add(r);
    }
  }
  const linkRules = opts.links === false ? undefined : (opts.links ?? {});
  const classify = (acc: RouteAcc, route: string, e: Pick<InventoryElement, 'key' | 'tag' | 'attrs' | 'href' | 'frames'>, url: string, byFile: boolean) => {
    // Component tests (views by spec file): links lead to no view.
    const c: LinkClass = linkRules && !byFile ? classifyLink(e, url, route, { viewOf, included, internal, rules: linkRules }) : { kind: 'element' };
    let k = acc.kinds.get(e.key);
    if (!k) acc.kinds.set(e.key, (k = { element: false, links: new Map() }));
    if (c.kind === 'element') k.element = true;
    else if (c.kind === 'link') {
      if (!k.links.has(c.view)) k.links.set(c.view, new Set());
      k.links.get(c.view)!.add(c.url);
    }
  };

  // Pass 1: inventories.
  for (const { title, testId, data } of tests) {
    for (const snap of data.snapshots) {
      const route = routeName(snap.url, data.view);
      if (route === undefined) continue;
      const acc = routeFor(route);
      acc.snapshots.push({ snap, test: title, testId });
      for (const el of snap.elements) classify(acc, route, el, snap.url, data.view !== undefined);
      // A label joined into its control's element is neither an instance nor a label variant.
      const counts = new Map<string, number>();
      for (const el of snap.elements) if (!el.grouping?.joined) counts.set(el.key, (counts.get(el.key) ?? 0) + 1);
      for (const el of [...snap.elements].sort((a, b) => Number(!!a.grouping?.joined) - Number(!!b.grouping?.joined))) {
        const existing = acc.elements.get(el.key);
        const n = counts.get(el.key) ?? 1;
        if (existing) {
          existing.instances = Math.max(existing.instances, n);
          if (!el.grouping?.joined && !existing.labels.has(el.label)) existing.labels.set(el.label, details(el));
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
      const route = routeName(i.url, data.view);
      if (route === undefined) continue;
      const acc = routeFor(route);
      if (!acc.kinds.has(i.key)) classify(acc, route, { ...i, tag: i.role === 'link' ? 'a' : '?' }, i.url, data.view !== undefined);
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
  /** Untested destination view → its URLs and referrers. */
  const unvisited = new Map<string, { urls: Set<string>; referrers: UntestedView['referrers'] }>();
  for (const [route, acc] of routes) {
    const withIds = tests.some((t) => t.testId);
    const groups = grouping.groups.get(route);
    const all = [...acc.elements.values()].map(({ testedBySet, failingSet, labels, idSet, failingIdSet, ...e }) => {
      // A heuristic group with one member seen once is just an element.
      let group = groups?.get(e.key);
      if (group && group.reason !== 'markup' && group.reason !== 'config' && group.members < 2 && e.instances < 2)
        group = undefined;
      if (!group && e.instances > 1) group = { reason: 'same-key', members: 1 };
      // Elements sharing a key (e.g. a link on every table row) can have different
      // labels; pick one independent of test order so reports are reproducible.
      const sorted = [...labels.keys()].sort();
      return {
        ...e,
        ...labels.get(sorted[0]),
        label: sorted.length > 1 ? `${sorted[0]} (+${sorted.length - 1} variants)` : sorted[0],
        ...(group ? { group } : {}),
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

    // A key with any instance that is a link to another view is a referrer of
    // link units, not an element (so it never counts twice). Otherwise it is an
    // element, unless every instance was ignored (external links with `external: 'ignore'`).
    const elements: ElementCoverage[] = [];
    const units = new Map<string, { urls: Set<string>; referrers: ElementCoverage[] }>();
    for (const e of all) {
      const k = acc.kinds.get(e.key);
      if (k && k.links.size) {
        for (const [view, urls] of k.links) {
          if (!units.has(view)) units.set(view, { urls: new Set(), referrers: [] });
          const u = units.get(view)!;
          urls.forEach((x) => u.urls.add(x));
          u.referrers.push(e);
        }
      } else if (!k || k.element) elements.push(e);
    }
    const links: LinkCoverage[] = [...units].map(([view, u]) => {
      u.referrers.sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
      const urls = [...u.urls].sort();
      const more = u.referrers.length - 1;
      return {
        key: view,
        label: u.referrers[0].label + (more ? ` (+${more} more)` : ''),
        tested: visited.has(view),
        destinations: urls.slice(0, MAX_DESTINATIONS),
        destinationCount: urls.length,
        referrers: u.referrers,
      };
    });
    links.sort((a, b) => Number(a.tested) - Number(b.tested) || a.key.localeCompare(b.key));
    if (elements.length === 0 && links.length === 0) continue;
    for (const l of links) {
      if (l.tested) continue;
      if (!unvisited.has(l.key)) unvisited.set(l.key, { urls: new Set(), referrers: [] });
      const u = unvisited.get(l.key)!;
      units.get(l.key)!.urls.forEach((x) => u.urls.add(x));
      u.referrers.push({ route, label: l.label, keys: l.referrers.map((e) => e.key) });
    }
    const counted = new Set([...elements, ...links.flatMap((l) => l.referrers)].map((e) => e.key));

    // Elements actually in the image: a cropped screenshot hides those below its
    // height, a viewport screenshot those outside the viewport. Zero-size boxes:
    // frame content scrolled out of its frame's viewport. Elements dropped above
    // (ignored external links) get no box.
    const visible = (snap: Snapshot) =>
      snap.elements.filter(
        (e) =>
          counted.has(e.key) &&
          e.w > 0 &&
          e.h > 0 &&
          (snap.screenshotClip
            ? intersects(e, snap.screenshotClip)
            : !snap.screenshotHeight || e.y < snap.screenshotHeight),
      );
    const box = (snap: Snapshot, e: Snapshot['elements'][number]): ScreenshotBox => {
      const { key, x, y, w, h, pos } = snap.screenshotClip ? boxInImage(e, snap.screenshotClip)! : e;
      return pos ? { key, x, y, w, h, pos } : { key, x, y, w, h };
    };
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
        ...(snap.screenshotClip ? { viewport: true as const } : {}),
        boxes: inImage.map((e) => box(snap, e)),
      });
    }

    // A box is tested like the report draws it: an element by its own state, a
    // link's <a> when every destination it leads to was visited.
    const testedKeys = new Map<string, boolean>(elements.map((e) => [e.key, e.tested]));
    for (const l of links) for (const e of l.referrers) testedKeys.set(e.key, (testedKeys.get(e.key) ?? true) && l.tested);
    const { states, indexOf } = routeStates(
      stateCandidates.get(route) ?? [],
      (snap) => visible(snap).map((e) => box(snap, e)),
      (key) => testedKeys.get(key) ?? false,
    );
    for (const [snap, index] of indexOf) stateRefs.set(snap, { route, index });

    const testedLinks = links.filter((l) => l.tested).length;
    const tested = elements.filter((e) => e.tested).length + testedLinks;
    const total = elements.length + links.length;
    const failingOnly = elements.filter((e) => !e.tested && e.testedByFailing.length > 0).length;
    elements.sort((a, b) => Number(a.tested) - Number(b.tested) || a.label.localeCompare(b.label));
    result.push({
      route,
      total,
      tested,
      percent: percent(tested, total),
      totalLinks: links.length,
      testedLinks,
      failingOnly,
      elements,
      links,
      screenshots: chosen,
      ...(states.length ? { states } : {}),
    });
  }

  result.sort((a, b) => a.route.localeCompare(b.route));
  // The walkthrough of each attempt, and links from "Tested by" to its steps.
  walkSteps(tests, attemptOf, attempts, routeName, (snap) => stateRefs.get(snap));
  const first = firstSteps(attempts);
  for (const r of result) {
    const byKey = first.get(r.route);
    if (!byKey) continue;
    for (const e of allElements(r)) {
      const byTest = byKey.get(e.key);
      if (byTest?.size) e.firstStep = Object.fromEntries([...byTest].sort(([a], [b]) => a.localeCompare(b)));
    }
  }
  const sum = (k: 'total' | 'tested' | 'totalLinks' | 'testedLinks' | 'failingOnly') => result.reduce((s, r) => s + r[k], 0);
  // A view seen only in attempts that don't count is in `routes` already; its links stay untested.
  const listed = new Set(result.map((r) => r.route));
  const untestedViews: UntestedView[] = [...unvisited]
    .filter(([view]) => !listed.has(view))
    .map(([view, u]) => {
      const urls = [...u.urls].sort();
      return {
        view,
        destinations: urls.slice(0, MAX_DESTINATIONS),
        destinationCount: urls.length,
        referrers: u.referrers.sort((a, b) => a.route.localeCompare(b.route)),
      };
    })
    .sort((a, b) => a.view.localeCompare(b.view));
  return {
    generatedAt: new Date().toISOString(),
    total: sum('total'),
    tested: sum('tested'),
    percent: percent(sum('tested'), sum('total')),
    totalLinks: sum('totalLinks'),
    testedLinks: sum('testedLinks'),
    failingOnly: sum('failingOnly'),
    routes: result,
    untestedViews,
    ...(attempts.length ? { attempts } : {}),
  };
}
