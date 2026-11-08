/**
 * Baseline mode (ratchet): a committed file lists, per view, the units that
 * are untested today. A run fails only when a view has an untested unit the
 * baseline doesn't list (a new gap). The current state is always written next
 * to it (`.next.json`), so improvements can be committed.
 *
 * `createBaseline` and `checkBaseline` are pure; `runBaseline` does the I/O.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { BaselineCheck, BaselineGap, BaselineResolved, CoverageReport, ViewRename } from './coverage-report';
import { byString, matchRenames, unitId, unitsOf, type Unit, type UnitKind } from './units';

export const BASELINE_VERSION = 1;
export const DEFAULT_BASELINE_FILE = 'ui-coverage-baseline.json';

/** `ui-coverage-baseline.json`: what is untested today, per view. */
export interface BaselineFile {
  baselineVersion: typeof BASELINE_VERSION;
  /** View name → its untested keys, sorted. Views with nothing untested are kept (with empty lists). */
  views: Record<string, BaselineView>;
}

export interface BaselineView {
  untestedElements: string[];
  /** Present only when the view has untested links. */
  untestedLinks?: string[];
}

export type BaselineMode = 'check' | 'update' | 'off';

/**
 * Reporter option. A string is the file (mode `check`); `true` is the default
 * file. Relative paths are relative to the Playwright config file (or, for the
 * CLI, to `--config`'s folder, else the working directory).
 */
export type BaselineOption =
  | boolean
  | string
  | {
      /** Default: `ui-coverage-baseline.json`. */
      file?: string;
      /**
       * `check` (default): fail on new gaps and write `<file>.next.json`.
       * `update`: rewrite `<file>` with the current state, never fail.
       * `off`: do nothing.
       */
      mode?: BaselineMode;
      /**
       * Allow untested units in views the baseline doesn't have yet (they are
       * listed as added views but don't fail). Default: false, so a new page
       * needs tests or a baseline update. Renamed views are matched either way.
       */
      allowNewViews?: boolean;
    };

export interface ResolvedBaselineOption {
  file: string;
  mode: BaselineMode;
  allowNewViews: boolean;
}

export function resolveBaselineOption(option: BaselineOption | undefined, baseDir: string): ResolvedBaselineOption | undefined {
  if (option === undefined || option === false) return undefined;
  const o = option === true ? {} : typeof option === 'string' ? { file: option } : option;
  if (typeof o !== 'object' || o === null) throw new Error(`baseline: expected a file name or { file, mode, allowNewViews }`);
  const mode = o.mode ?? 'check';
  if (!['check', 'update', 'off'].includes(mode)) throw new Error(`baseline.mode: expected 'check', 'update' or 'off', got ${JSON.stringify(mode)}`);
  if (mode === 'off') return undefined;
  return { file: path.resolve(baseDir, o.file ?? DEFAULT_BASELINE_FILE), mode, allowNewViews: o.allowNewViews ?? false };
}

/** `ui-coverage-baseline.json` → `ui-coverage-baseline.next.json`. */
export function nextFileOf(file: string): string {
  return file.toLowerCase().endsWith('.json') ? `${file.slice(0, -5)}.next.json` : `${file}.next.json`;
}

const sorted = (keys: Iterable<string>) => [...new Set(keys)].sort(byString);

/** The baseline for a report: every view, with its untested keys. */
export function createBaseline(report: CoverageReport): BaselineFile {
  const views: Record<string, BaselineView> = {};
  for (const name of report.views.map((v) => v.name).sort(byString)) {
    const units = unitsOf(report.views.find((v) => v.name === name)!).filter((u) => !u.tested);
    const links = sorted(units.filter((u) => u.kind === 'link').map((u) => u.key));
    views[name] = {
      untestedElements: sorted(units.filter((u) => u.kind === 'element').map((u) => u.key)),
      ...(links.length ? { untestedLinks: links } : {}),
    };
  }
  return { baselineVersion: BASELINE_VERSION, views };
}

export function parseBaseline(value: unknown, file: string): BaselineFile {
  const v = value as Partial<BaselineFile> | null;
  if (!v || typeof v !== 'object' || typeof v.views !== 'object' || v.views === null || Array.isArray(v.views))
    throw new Error(`${file} is not a UI coverage baseline (expected { baselineVersion, views })`);
  if (v.baselineVersion !== BASELINE_VERSION)
    throw new Error(`${file} has baselineVersion ${String(v.baselineVersion)}; this version reads ${BASELINE_VERSION}`);
  for (const [name, view] of Object.entries(v.views)) {
    const ok = (l: unknown) => l === undefined || (Array.isArray(l) && l.every((k) => typeof k === 'string'));
    if (!view || !Array.isArray(view.untestedElements) || !ok(view.untestedElements) || !ok(view.untestedLinks))
      throw new Error(`${file}: view ${JSON.stringify(name)} must have untestedElements (and optionally untestedLinks) string arrays`);
  }
  return v as BaselineFile;
}

/** What a baseline check found (the list part of `BaselineCheck`). */
export interface BaselineDiff {
  newGaps: BaselineGap[];
  resolved: BaselineResolved[];
  addedViews: string[];
  removedViews: string[];
  renamedViews: ViewRename[];
}

const baselineIds = (v: BaselineView) =>
  new Set([...v.untestedElements.map((k) => unitId('element', k)), ...(v.untestedLinks ?? []).map((k) => unitId('link', k))]);

const splitId = (id: string): { kind: UnitKind; key: string } => {
  const i = id.indexOf('\u0000');
  return { kind: id.slice(0, i) as UnitKind, key: id.slice(i + 1) };
};

/**
 * Compares a report with a baseline. Pure.
 *
 * - A view in both: its untested units not in the baseline are new gaps; units
 *   the baseline lists that are now tested or gone are resolved.
 * - A view only in the report: an added view. Its untested units are new gaps
 *   unless `allowNewViews`.
 * - A view only in the baseline: a removed view; never a failure.
 * - A removed and an added view with similar untested keys are a rename and
 *   are compared like a view in both.
 */
export function checkBaseline(
  baseline: BaselineFile,
  report: CoverageReport,
  options: { allowNewViews?: boolean } = {},
): BaselineDiff {
  const current = new Map<string, Map<string, Unit>>();
  for (const v of report.views) current.set(v.name, new Map(unitsOf(v).map((u) => [unitId(u.kind, u.key), u])));
  const untestedIds = (units: Map<string, Unit>) => new Set([...units].filter(([, u]) => !u.tested).map(([id]) => id));

  const base = new Map(Object.entries(baseline.views).map(([name, v]) => [name, baselineIds(v)]));
  const removed = new Map([...base].filter(([name]) => !current.has(name)));
  const added = new Map([...current].filter(([name]) => !base.has(name)).map(([name, units]) => [name, untestedIds(units)]));
  const renamedViews = matchRenames(removed, added);
  const renamedFrom = new Map(renamedViews.map((r) => [r.to, r.from]));

  const newGaps: BaselineGap[] = [];
  const resolved: BaselineResolved[] = [];
  for (const name of [...current.keys()].sort(byString)) {
    const units = current.get(name)!;
    const known = base.get(name) ?? base.get(renamedFrom.get(name) ?? '\u0000');
    const untested = untestedIds(units);
    if (!known) {
      if (options.allowNewViews) continue;
      for (const id of untested) {
        const u = units.get(id)!;
        newGaps.push({ view: name, kind: u.kind, key: u.key, label: u.label, newView: true });
      }
      continue;
    }
    for (const id of untested) {
      if (known.has(id)) continue;
      const u = units.get(id)!;
      newGaps.push({ view: name, kind: u.kind, key: u.key, label: u.label, newView: false });
    }
    for (const id of known) {
      if (untested.has(id)) continue;
      const u = units.get(id);
      const { kind, key } = splitId(id);
      resolved.push(u ? { view: name, kind, key, reason: 'tested', label: u.label } : { view: name, kind, key, reason: 'removed' });
    }
  }
  const order = (a: { view: string; kind: string; key: string }, b: typeof a) =>
    byString(a.view, b.view) || byString(a.kind, b.kind) || byString(a.key, b.key);
  newGaps.sort(order);
  resolved.sort(order);
  return {
    newGaps,
    resolved,
    addedViews: [...added.keys()].filter((n) => !renamedFrom.has(n)).sort(byString),
    removedViews: [...removed.keys()].filter((n) => !renamedViews.some((r) => r.from === n)).sort(byString),
    renamedViews,
  };
}

const quote = (s: string) => JSON.stringify(s);

/** Console lines for a baseline check: `info` always, `errors` when it failed. */
export function formatBaselineCheck(check: BaselineCheck, maxItems = 20): { info: string[]; errors: string[] } {
  const info: string[] = [];
  const list = <T>(items: T[], line: (x: T) => string, out: string[]) => {
    for (const x of items.slice(0, maxItems)) out.push(`    ${line(x)}`);
    if (items.length > maxItems) out.push(`    … and ${items.length - maxItems} more (see coverage.json "baseline")`);
  };
  const gap = (g: BaselineGap) => `${g.view}  ${g.label}  ${g.key}${g.newView ? '  (new view)' : ''}`;
  for (const r of check.renamedViews) info.push(`  view renamed?  ${r.from} → ${r.to} (compared with its old entry)`);
  if (check.addedViews.length)
    info.push(`  view(s) added: ${check.addedViews.join(', ')}${check.allowNewViews ? ' (allowed by allowNewViews)' : ''}`);
  if (check.removedViews.length) info.push(`  view(s) not in this run: ${check.removedViews.join(', ')}`);
  const tested = check.resolved.filter((r) => r.reason === 'tested');
  const gone = check.resolved.length - tested.length;
  if (check.resolved.length) {
    info.push(`  ${tested.length} gap(s) now tested${gone ? `, ${gone} untested element(s) gone` : ''}:`);
    list(check.resolved, (r) => `${r.view}  ${r.label ?? '(removed)'}  ${r.key}`, info);
  }

  const errors: string[] = [];
  if (check.status === 'updated') {
    const header = [`UI coverage baseline updated: ${check.file}`];
    if (check.newGaps.length) {
      header.push(`  ${check.newGaps.length} untested element(s) added to the baseline:`);
      list(check.newGaps, gap, header);
    }
    return { info: [...header, ...info], errors };
  }
  if (check.status === 'missing') {
    return {
      info: [
        `UI coverage baseline: ${check.file} not found; not checked. Wrote the current state to ${check.nextFile}:`,
        `  commit it as ${check.file} (or run \`npx playwright-ui-coverage baseline update\`) to start.`,
      ],
      errors,
    };
  }
  const next = check.nextFile ? ` Current state: ${check.nextFile}` : '';
  if (check.status === 'passed') {
    const improved = check.resolved.length || check.removedViews.length ? ` Commit it as ${check.file} to ratchet.` : '';
    return { info: [`UI coverage baseline: no new untested elements (${check.file}).${next ? next + '.' : ''}${improved}`, ...info], errors };
  }
  errors.push(`UI coverage baseline: ${check.newGaps.length} new untested element(s) not in ${check.file}:`);
  list(check.newGaps, gap, errors);
  errors.push(
    `  Test them, or accept them by committing ${check.nextFile ?? 'the new state'} as ${check.file}` +
      ` (\`npx playwright-ui-coverage baseline update\`).`,
  );
  return { info, errors };
}

const rel = (from: string, file: string) => path.relative(from, file).split(path.sep).join('/') || '.';

/**
 * Runs the baseline option for a report written to `outDir`: reads the
 * baseline, writes `.next.json` (check) or the baseline itself (update).
 */
export function runBaseline(report: CoverageReport, option: ResolvedBaselineOption, outDir: string): BaselineCheck {
  let baseline: BaselineFile | undefined;
  if (fs.existsSync(option.file)) baseline = parseBaseline(JSON.parse(fs.readFileSync(option.file, 'utf8')), option.file);
  const diff: BaselineDiff = baseline
    ? checkBaseline(baseline, report, { allowNewViews: option.allowNewViews })
    : { newGaps: [], resolved: [], addedViews: [], removedViews: [], renamedViews: [] };
  const content = JSON.stringify(createBaseline(report), null, 2) + '\n';
  const check: BaselineCheck = {
    file: rel(outDir, option.file),
    mode: option.mode === 'update' ? 'update' : 'check',
    status: 'passed',
    allowNewViews: option.allowNewViews,
    ...diff,
  };
  fs.mkdirSync(path.dirname(option.file), { recursive: true });
  if (option.mode === 'update') {
    fs.writeFileSync(option.file, content);
    check.status = 'updated';
  } else {
    const next = nextFileOf(option.file);
    fs.writeFileSync(next, content);
    check.nextFile = rel(outDir, next);
    check.status = !baseline ? 'missing' : diff.newGaps.length ? 'failed' : 'passed';
  }
  return check;
}

/** Paths in a `BaselineCheck` are relative to coverage.json; rewrites them for console output. */
export function forDisplay(check: BaselineCheck, outDir: string, cwd = process.cwd()): BaselineCheck {
  const show = (p: string) => {
    const r = path.relative(cwd, path.resolve(outDir, p));
    return r.startsWith('..') ? path.resolve(outDir, p) : r;
  };
  return { ...check, file: show(check.file), ...(check.nextFile ? { nextFile: show(check.nextFile) } : {}) };
}
