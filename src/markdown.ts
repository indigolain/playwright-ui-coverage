/**
 * Markdown for PR comments (`compare --format markdown`) and the GitHub step
 * summary (`githubSummary`, `summary` CLI). Pure: no I/O. Output is
 * deterministic for the same input (no timestamps, stable ordering).
 */
import type { BaselineCheck, CoverageReport, ThresholdCheck } from './coverage-report';
import type { ComparedUnit, CoverageComparison, ThresholdChange, ViewComparison, ViewTotals } from './compare';
import { byString } from './units';

/** First line of every comment: lets sticky-comment actions find and update it. */
export const MARKDOWN_MARKER = '<!-- playwright-ui-coverage -->';

export interface MarkdownOptions {
  /** URL of the published HTML report (its index.html); views link to `#<view>`. */
  reportUrl?: string;
  /** Max entries per list before "… and N more". Default: 50. */
  maxItems?: number;
  /** Lists longer than this are collapsed in `<details>`. Default: 10. */
  collapseAfter?: number;
  /** Heading text. Default: "UI coverage". */
  title?: string;
}

/** Escapes text for markdown (outside code spans). */
export function mdText(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/[\\`*_[\]<>|~]/g, '\\$&');
}

/** Inline code that survives backticks in `s`; `inTable` also escapes `|` (GFM tables). */
export function mdCode(s: string, inTable = false): string {
  let t = s.replace(/\s+/g, ' ');
  if (inTable) t = t.replace(/\|/g, '\\|');
  const longest = Math.max(0, ...(t.match(/`+/g) ?? []).map((m) => m.length));
  const fence = '`'.repeat(longest + 1);
  const pad = t.startsWith('`') || t.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${t}${pad}${fence}`;
}

const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
const delta = (n: number) => (n > 0 ? `+${n.toFixed(1)} pp` : n < 0 ? `${n.toFixed(1)} pp` : '±0 pp');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const totals = (t: ViewTotals) => `${pct(t.coverage)} (${t.testedUnits}/${t.totalUnits})`;

function viewRef(name: string, o: MarkdownOptions, inTable = false): string {
  const c = mdCode(name, inTable);
  return o.reportUrl ? `[${c}](${o.reportUrl}#${encodeURIComponent(name)})` : c;
}

/** A list, collapsed when long, truncated at `maxItems`. */
function section(title: string, lines: string[], o: MarkdownOptions, out: string[]) {
  if (!lines.length) return;
  const max = o.maxItems ?? 50;
  const shown = lines.slice(0, max);
  if (lines.length > max) shown.push(`- … and ${lines.length - max} more (see the report)`);
  out.push('');
  if (lines.length > (o.collapseAfter ?? 10)) {
    out.push(`<details><summary><b>${title}</b></summary>`, '', ...shown, '', '</details>');
  } else {
    out.push(`**${title}**`, '', ...shown);
  }
}

const reasonText: Record<ComparedUnit['reason'], string> = {
  regressed: 'was tested',
  new: 'new element',
  'new-view': 'new view',
  tested: 'now tested',
};

function unitLine(u: ComparedUnit, o: MarkdownOptions): string {
  const kind = u.kind === 'link' ? 'link ' : '';
  return `- ${viewRef(u.view, o)} ${kind}${mdText(u.label)} (${reasonText[u.reason]}) ${mdCode(u.key)}`;
}

const thresholdTarget = (t: { scope: string; view?: string; pattern?: string }, o: MarkdownOptions) =>
  t.scope === 'overall' ? 'overall' : `${viewRef(t.view ?? '', o)}${t.pattern && t.pattern !== t.view ? ` (via ${mdCode(t.pattern)})` : ''}`;

const thresholdState = (s: { actual: number | null; status: ThresholdCheck['status'] } | undefined, required: number) =>
  !s ? 'not checked' : s.status === 'missing' ? 'view missing' : `${s.status} (${pct(s.actual ?? 0)} ${s.status === 'failed' ? '<' : '≥'} ${pct(required)})`;

function thresholdChangeLine(t: ThresholdChange, o: MarkdownOptions): string {
  const now = thresholdState(t.head, t.required);
  return `- ${thresholdTarget(t, o)}: **${now}**, was ${thresholdState(t.base, t.required)}`;
}

function viewRow(v: ViewComparison, o: MarkdownOptions): string {
  const name =
    v.status === 'renamed' ? `${viewRef(v.name, o, true)} (was ${mdCode(v.from ?? '', true)})` : viewRef(v.name, o, true);
  const b = v.base ? totals(v.base) : '—';
  const h = v.head ? totals(v.head) : '—';
  const d = v.status === 'added' ? 'new' : v.status === 'removed' ? 'removed' : delta(v.delta ?? 0);
  return `| ${name} | ${b} | ${h} | ${d} | ${v.newGaps} | ${v.resolved} |`;
}

/** Markdown for a comparison of two runs, for a (sticky) PR comment. */
export function comparisonMarkdown(c: CoverageComparison, o: MarkdownOptions = {}): string {
  const out: string[] = [MARKDOWN_MARKER];
  const title = o.title ?? 'UI coverage';
  out.push(`### ${mdText(title)}: ${pct(c.head.coverage)} (${delta(c.delta)})`, '');
  out.push(
    '| | Coverage | Tested | Views |',
    '|---|---:|---:|---:|',
    `| Base | ${pct(c.base.coverage)} | ${c.base.testedUnits}/${c.base.totalUnits} | ${c.base.viewCount} |`,
    `| Head | **${pct(c.head.coverage)}** | ${c.head.testedUnits}/${c.head.totalUnits} | ${c.head.viewCount} |`,
    '',
  );
  const facts = [
    c.newGaps.length ? `**${plural(c.newGaps.length, 'new untested element')}**` : 'no new untested elements',
    `${c.resolved.length} resolved`,
  ];
  if (c.addedViews.length) facts.push(`${plural(c.addedViews.length, 'view')} added`);
  if (c.removedViews.length) facts.push(`${plural(c.removedViews.length, 'view')} removed`);
  if (c.renamedViews.length) facts.push(`${plural(c.renamedViews.length, 'view')} renamed`);
  const { base: fb, head: fh } = c.failedThresholds;
  if (fb || fh) facts.push(`thresholds: **${fh} failing**${fb !== fh ? ` (was ${fb})` : ''}`);
  out.push(facts.join(' · '));

  const changed = c.views.filter((v) => v.status !== 'unchanged');
  const unchanged = c.views.length - changed.length;
  if (changed.length) {
    const rows = [
      '| View | Base | Head | Δ | New gaps | Resolved |',
      '|---|---:|---:|---:|---:|---:|',
      ...changed.map((v) => viewRow(v, o)),
    ];
    out.push('');
    const label = `Views changed (${changed.length})${unchanged ? `, ${unchanged} unchanged` : ''}`;
    if (changed.length > (o.collapseAfter ?? 10)) out.push(`<details><summary><b>${label}</b></summary>`, '', ...rows, '', '</details>');
    else out.push(`**${label}**`, '', ...rows);
  } else {
    out.push('', `All ${plural(c.views.length, 'view')} unchanged.`);
  }

  section(`New untested elements (${c.newGaps.length})`, c.newGaps.map((u) => unitLine(u, o)), o, out);
  section(`Resolved: now tested (${c.resolved.length})`, c.resolved.map((u) => unitLine(u, o)), o, out);
  section(`Threshold changes (${c.thresholdChanges.length})`, c.thresholdChanges.map((t) => thresholdChangeLine(t, o)), o, out);
  out.push('');
  return out.join('\n');
}

function baselineLines(b: BaselineCheck, o: MarkdownOptions, out: string[]) {
  out.push('');
  if (b.status === 'missing') {
    out.push(`**Baseline:** ${mdCode(b.file)} not found; not checked.`);
    return;
  }
  if (b.status === 'updated') {
    out.push(`**Baseline:** updated ${mdCode(b.file)}.`);
    return;
  }
  const resolved = b.resolved.length ? `, ${plural(b.resolved.length, 'gap')} resolved (commit ${mdCode(b.nextFile ?? '')} to ratchet)` : '';
  if (b.status === 'passed') {
    out.push(`**Baseline:** passed, no new untested elements${resolved}.`);
  } else {
    out.push(`**Baseline: failed**, ${plural(b.newGaps.length, 'new untested element')} not in ${mdCode(b.file)}${resolved}.`);
  }
  const lines = b.newGaps.map(
    (g) => `- ${viewRef(g.view, o)} ${g.kind === 'link' ? 'link ' : ''}${mdText(g.label)}${g.newView ? ' (new view)' : ''} ${mdCode(g.key)}`,
  );
  section(`New untested elements (${b.newGaps.length})`, lines, o, out);
}

/** Markdown summary of one run, for `$GITHUB_STEP_SUMMARY`. */
export function reportMarkdown(r: CoverageReport, o: MarkdownOptions = {}): string {
  const s = r.summary;
  const tested = s.testedElementsCount + s.testedLinksCount;
  const total = tested + s.untestedElementsCount + s.untestedLinksCount;
  const out: string[] = [MARKDOWN_MARKER, `### ${mdText(o.title ?? 'UI coverage')}: ${pct(s.coverage)} (${tested}/${total})`, ''];
  const rows = [...r.views]
    .sort((a, b) => byString(a.name, b.name))
    .map((v) => {
      const t = v.summary.testedElementsCount + v.summary.testedLinksCount;
      const u = v.summary.untestedElementsCount + v.summary.untestedLinksCount;
      return `| ${viewRef(v.name, o, true)} | ${pct(v.summary.coverage)} | ${t}/${t + u} |`;
    });
  const table = ['| View | Coverage | Tested |', '|---|---:|---:|', ...rows];
  const label = `Views (${rows.length})`;
  if (rows.length > (o.collapseAfter ?? 10) * 2) out.push(`<details><summary><b>${label}</b></summary>`, '', ...table, '', '</details>');
  else out.push(...table);

  const thresholds = r.thresholds ?? [];
  if (thresholds.length) {
    const failed = thresholds.filter((t) => t.status === 'failed');
    out.push('', failed.length ? `**Thresholds: ${failed.length} failing**` : '**Thresholds:** all met');
    for (const t of failed) out.push(`- ${thresholdTarget(t, o)}: ${pct(t.actual ?? 0)} < ${pct(t.required)}`);
  }
  if (r.baseline) baselineLines(r.baseline, o, out);
  out.push('');
  return out.join('\n');
}
