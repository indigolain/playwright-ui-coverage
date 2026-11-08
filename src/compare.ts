/**
 * Compares two coverage.json reports (base = e.g. main, head = the PR).
 * Pure: no I/O. Rendered as markdown by markdown.ts, or written as JSON
 * (`playwright-ui-coverage compare --format json`).
 */
import type { CoverageCounts, CoverageReport, ThresholdCheck, ViewRename } from './coverage-report';
import { byString, matchRenames, unitId, unitsOf, type Unit, type UnitKind } from './units';

export const COMPARISON_VERSION = 1;

/** Totals of one run. Units are elements plus links (the coverage denominator). */
export interface RunTotals {
  coverage: number;
  testedUnits: number;
  totalUnits: number;
  viewCount: number;
  generatedAt: string;
}

export interface ViewTotals {
  coverage: number;
  testedUnits: number;
  totalUnits: number;
}

export interface ViewComparison {
  /** Head name (base name for a removed view). */
  name: string;
  /**
   * `added`/`removed`: only in head/base. `renamed`: matched by similar keys
   * (`from` is the base name). `changed`: a count, coverage or unit changed.
   */
  status: 'added' | 'removed' | 'renamed' | 'changed' | 'unchanged';
  from?: string;
  base?: ViewTotals;
  head?: ViewTotals;
  /** head − base coverage in percentage points; absent for added/removed views. */
  delta?: number;
  newGaps: number;
  resolved: number;
}

export interface ComparedUnit {
  view: string;
  kind: UnitKind;
  key: string;
  label: string;
  /**
   * New gaps: `regressed` (tested in base), `new` (not in the base view) or
   * `new-view` (the view isn't in base). Resolved: `tested` (untested in base).
   */
  reason: 'regressed' | 'new' | 'new-view' | 'tested';
}

export interface ThresholdChange {
  scope: 'overall' | 'view';
  view?: string;
  pattern?: string;
  required: number;
  /** Absent when the check didn't exist in that run. */
  base?: Pick<ThresholdCheck, 'actual' | 'status'>;
  head?: Pick<ThresholdCheck, 'actual' | 'status'>;
}

export interface CoverageComparison {
  comparisonVersion: typeof COMPARISON_VERSION;
  base: RunTotals;
  head: RunTotals;
  /** head − base overall coverage, percentage points, one decimal. */
  delta: number;
  /** Every view of either run, by name. */
  views: ViewComparison[];
  /** Untested in head and not untested in base, by view, kind, key. */
  newGaps: ComparedUnit[];
  /** Untested in base, tested in head. */
  resolved: ComparedUnit[];
  addedViews: string[];
  removedViews: string[];
  renamedViews: ViewRename[];
  /** Threshold checks whose status changed (or that appeared/disappeared). */
  thresholdChanges: ThresholdChange[];
  /** Number of `failed` threshold checks in each run. */
  failedThresholds: { base: number; head: number };
}

const round = (n: number) => Math.round(n * 10) / 10;

function viewTotals(c: CoverageCounts): ViewTotals {
  return {
    coverage: c.coverage,
    testedUnits: c.testedElementsCount + c.testedLinksCount,
    totalUnits: c.testedElementsCount + c.untestedElementsCount + c.testedLinksCount + c.untestedLinksCount,
  };
}

function runTotals(r: CoverageReport): RunTotals {
  return { ...viewTotals(r.summary), viewCount: r.views.length, generatedAt: r.generatedAt };
}

const thresholdId = (t: ThresholdCheck) => JSON.stringify([t.scope, t.view ?? '', t.pattern ?? '', t.required]);

function compareThresholds(base: ThresholdCheck[], head: ThresholdCheck[]): ThresholdChange[] {
  const b = new Map(base.map((t) => [thresholdId(t), t]));
  const h = new Map(head.map((t) => [thresholdId(t), t]));
  const out: ThresholdChange[] = [];
  for (const id of new Set([...b.keys(), ...h.keys()])) {
    const x = b.get(id);
    const y = h.get(id);
    if (x && y && x.status === y.status) continue;
    const t = (y ?? x)!;
    out.push({
      scope: t.scope,
      ...(t.view !== undefined ? { view: t.view } : {}),
      ...(t.pattern !== undefined ? { pattern: t.pattern } : {}),
      required: t.required,
      ...(x ? { base: { actual: x.actual, status: x.status } } : {}),
      ...(y ? { head: { actual: y.actual, status: y.status } } : {}),
    });
  }
  return out.sort((x, y) => byString(x.scope, y.scope) || byString(x.view ?? '', y.view ?? '') || byString(x.pattern ?? '', y.pattern ?? ''));
}

export function compareReports(base: CoverageReport, head: CoverageReport): CoverageComparison {
  const unitMap = (r: CoverageReport) =>
    new Map(r.views.map((v) => [v.name, new Map(unitsOf(v).map((u) => [unitId(u.kind, u.key), u]))]));
  const baseUnits = unitMap(base);
  const headUnits = unitMap(head);
  const baseViews = new Map(base.views.map((v) => [v.name, v]));
  const headViews = new Map(head.views.map((v) => [v.name, v]));

  const keySet = (units: Map<string, Unit>) => new Set(units.keys());
  const removed = new Map([...baseUnits].filter(([n]) => !headUnits.has(n)).map(([n, u]) => [n, keySet(u)]));
  const added = new Map([...headUnits].filter(([n]) => !baseUnits.has(n)).map(([n, u]) => [n, keySet(u)]));
  const renamedViews = matchRenames(removed, added);
  const renamedFrom = new Map(renamedViews.map((r) => [r.to, r.from]));
  const renamedTo = new Set(renamedViews.map((r) => r.from));

  const newGaps: ComparedUnit[] = [];
  const resolved: ComparedUnit[] = [];
  const views: ViewComparison[] = [];

  for (const [name, units] of headUnits) {
    const from = baseUnits.has(name) ? name : renamedFrom.get(name);
    const before = from !== undefined ? baseUnits.get(from)! : undefined;
    let gaps = 0;
    let fixed = 0;
    for (const [id, u] of units) {
      const was = before?.get(id);
      if (!u.tested && !(was && !was.tested)) {
        gaps++;
        newGaps.push({ view: name, kind: u.kind, key: u.key, label: u.label, reason: !before ? 'new-view' : was ? 'regressed' : 'new' });
      } else if (u.tested && was && !was.tested) {
        fixed++;
        resolved.push({ view: name, kind: u.kind, key: u.key, label: u.label, reason: 'tested' });
      }
    }
    const h = viewTotals(headViews.get(name)!.summary);
    if (from === undefined) {
      views.push({ name, status: 'added', head: h, newGaps: gaps, resolved: 0 });
      continue;
    }
    const b = viewTotals(baseViews.get(from)!.summary);
    const sameUnits = before!.size === units.size && [...units.keys()].every((id) => before!.has(id));
    const changed = gaps > 0 || fixed > 0 || !sameUnits || JSON.stringify(b) !== JSON.stringify(h);
    views.push({
      name,
      status: from !== name ? 'renamed' : changed ? 'changed' : 'unchanged',
      ...(from !== name ? { from } : {}),
      base: b,
      head: h,
      delta: round(h.coverage - b.coverage),
      newGaps: gaps,
      resolved: fixed,
    });
  }
  for (const name of baseUnits.keys()) {
    if (headUnits.has(name) || renamedTo.has(name)) continue;
    views.push({ name, status: 'removed', base: viewTotals(baseViews.get(name)!.summary), newGaps: 0, resolved: 0 });
  }

  const order = (a: ComparedUnit, b: ComparedUnit) => byString(a.view, b.view) || byString(a.kind, b.kind) || byString(a.key, b.key);
  const b = runTotals(base);
  const h = runTotals(head);
  const failed = (r: CoverageReport) => (r.thresholds ?? []).filter((t) => t.status === 'failed').length;
  return {
    comparisonVersion: COMPARISON_VERSION,
    base: b,
    head: h,
    delta: round(h.coverage - b.coverage),
    views: views.sort((x, y) => byString(x.name, y.name)),
    newGaps: newGaps.sort(order),
    resolved: resolved.sort(order),
    addedViews: views.filter((v) => v.status === 'added').map((v) => v.name),
    removedViews: views.filter((v) => v.status === 'removed').map((v) => v.name),
    renamedViews,
    thresholdChanges: compareThresholds(base.thresholds ?? [], head.thresholds ?? []),
    failedThresholds: { base: failed(base), head: failed(head) },
  };
}
