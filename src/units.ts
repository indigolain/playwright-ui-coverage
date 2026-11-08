/**
 * Helpers shared by the baseline check (baseline.ts) and run comparison
 * (compare.ts): coverage units of a view and rename detection. Pure: no I/O.
 */
import type { CoverageReport, ViewCoverage } from './coverage-report';

export type UnitKind = 'element' | 'link';

/** A coverage unit of a view: an interactive element, or a link unit (key: the destination view). */
export interface Unit {
  kind: UnitKind;
  key: string;
  label: string;
  tested: boolean;
}

/**
 * Units of a view: its elements and its link units (`view.links`, `{ key,
 * tested, label? }` entries; reports written before link units have none).
 */
export function unitsOf(view: ViewCoverage): Unit[] {
  const out: Unit[] = view.elements.map((e) => ({ kind: 'element', key: e.key, label: e.label, tested: e.tested }));
  const links = (view as { links?: unknown }).links;
  if (Array.isArray(links)) {
    for (const l of links as { key?: unknown; tested?: unknown; label?: unknown }[]) {
      if (typeof l?.key !== 'string') continue;
      out.push({ kind: 'link', key: l.key, label: typeof l.label === 'string' ? l.label : l.key, tested: l.tested === true });
    }
  }
  return out;
}

/**
 * "untested element" / "untested link" / "untested element or link", for
 * messages about a list of units.
 */
export function unitNoun(units: { kind: UnitKind }[]): string {
  const kinds = new Set(units.map((u) => u.kind));
  return kinds.size === 2 ? 'untested element or link' : kinds.has('link') ? 'untested link' : 'untested element';
}

/** A unit for display: the label, and for a link its destination view (its key). */
export const unitText = (u: { kind: UnitKind; label: string; key: string }) =>
  u.kind === 'link' ? `${u.label} → ${u.key}` : u.label;

/** `kind` + key: element and link keys may coincide. */
export const unitId = (kind: UnitKind, key: string) => `${kind}\u0000${key}`;

/** Locale-independent string order, so output is the same on every machine. */
export const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Checks the version of a parsed coverage.json. */
export function assertCoverageReport(value: unknown, file: string): CoverageReport {
  const v = value as Partial<CoverageReport> | null;
  if (!v || typeof v !== 'object' || !Array.isArray(v.views) || !v.summary)
    throw new Error(`${file} is not a playwright-ui-coverage coverage.json`);
  if (v.schemaVersion !== 1)
    throw new Error(`${file} has coverage.json schemaVersion ${String(v.schemaVersion)}; this version reads 1`);
  return v as CoverageReport;
}

export interface Rename {
  from: string;
  to: string;
}

/**
 * Pairs views that disappeared with views that appeared when their key sets
 * are similar (Jaccard index >= `minSimilarity`), e.g. after a `normalizeUrl`
 * change renamed `/user/:id` to `/users/:id`. Greedy, most similar pair first;
 * ties broken by name, so the result is deterministic. Views with no keys on
 * either side are never paired.
 */
export function matchRenames(
  removed: Map<string, Set<string>>,
  added: Map<string, Set<string>>,
  minSimilarity = 0.5,
): Rename[] {
  const pairs: { from: string; to: string; score: number }[] = [];
  for (const [from, a] of removed) {
    for (const [to, b] of added) {
      if (a.size === 0 || b.size === 0) continue;
      let shared = 0;
      for (const k of a) if (b.has(k)) shared++;
      const score = shared / (a.size + b.size - shared);
      if (score >= minSimilarity) pairs.push({ from, to, score });
    }
  }
  pairs.sort((x, y) => y.score - x.score || byString(x.from, y.from) || byString(x.to, y.to));
  const usedFrom = new Set<string>();
  const usedTo = new Set<string>();
  const out: Rename[] = [];
  for (const p of pairs) {
    if (usedFrom.has(p.from) || usedTo.has(p.to)) continue;
    usedFrom.add(p.from);
    usedTo.add(p.to);
    out.push({ from: p.from, to: p.to });
  }
  return out.sort((x, y) => byString(x.to, y.to));
}
