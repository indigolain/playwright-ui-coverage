/**
 * Accessibility hints (node side, pure). Cheap checks on what the tracker
 * already records for each interactive element. Informational only: they
 * never change coverage numbers or fail a run.
 *
 * Not detectable from recorded data: elements that are clickable only through
 * a JS handler (a `<div onclick>` with no role, tabindex or
 * `data-uicov-interactive` is never inventoried), and names browsers compute
 * differently from the tracker's approximation.
 */
import { allElements, type CoverageSummary, type ElementCoverage } from './aggregate';
import { hasAccessibleName } from './locators';

export type A11yRule = 'no-name' | 'placeholder-only' | 'duplicate-name' | 'not-focusable' | 'no-role';

export interface A11yHint {
  rule: A11yRule;
  message: string;
}

export type A11yInput = Pick<ElementCoverage, 'key' | 'label' | 'tag' | 'instances'> &
  Partial<Pick<ElementCoverage, 'role' | 'name' | 'nameFrom' | 'attrs'>>;

/** Tags that are keyboard-focusable without a tabindex (`<a>` only with href). */
const FOCUSABLE_TAGS = new Set(['button', 'input', 'select', 'textarea', 'summary', 'iframe', 'audio', 'video']);

/** Hints for one element on its own (no comparison with other elements). */
export function elementHints(e: A11yInput): A11yHint[] {
  const hints: A11yHint[] = [];
  // Elements recorded before these fields existed: nothing to check.
  if (e.nameFrom === undefined) return hints;
  const role = e.role || e.label.split(' ')[0];
  const attrs = e.attrs;
  const nativeControl = FOCUSABLE_TAGS.has(e.tag) || (e.tag === 'a' && attrs?.href !== undefined);
  if (attrs && !attrs.role && attrs.contenteditable === undefined && !nativeControl && e.tag !== '?') {
    // A plain element (div, span…) counted as interactive. A name check doesn't
    // apply; flag it only when we know why it counts.
    if (attrs.tabindex !== undefined)
      hints.push({
        rule: 'no-role',
        message: `<${e.tag} tabindex> with no role: screen readers don't announce it as a control; use a <button> or add a role`,
      });
    else if ((attrs['data-uicov-interactive'] || '').trim().toLowerCase() === 'include')
      hints.push({
        rule: 'no-role',
        message: `<${e.tag}> with no role or tabindex: if it's clickable, keyboard and screen reader users can't use it; use a <button>`,
      });
    // Otherwise (scroll containers, draggable="true") there's nothing reliable to say.
    return hints;
  }
  if (!hasAccessibleName(e)) {
    const why =
      e.nameFrom === 'name'
        ? ' (the name attribute is not announced)'
        : e.nameFrom === 'text'
          ? ' (its text content does not name a ' + role + ')'
          : '';
    hints.push({
      rule: 'no-name',
      message: `No accessible name${why}: add a <label>, aria-label or aria-labelledby`,
    });
  } else if (e.nameFrom === 'placeholder') {
    hints.push({
      rule: 'placeholder-only',
      message: 'Named only by its placeholder, which disappears while typing: add a <label>',
    });
  }
  if (attrs?.role && e.tag !== '?' && attrs.tabindex === undefined) {
    if (!nativeControl && attrs.contenteditable === undefined)
      hints.push({
        rule: 'not-focusable',
        message: `role="${attrs.role}" on <${e.tag}> without tabindex: keyboard users can't reach it`,
      });
  }
  return hints;
}

/**
 * Hints that compare elements of one route: links with the same accessible
 * name that go to different places ("Read more", "Click here").
 * Only elements with different keys are compared: instances that share a key
 * (a link on every table row) record the attributes of one instance only.
 */
export function duplicateNameHints<T extends A11yInput>(elements: T[]): Map<T, A11yHint[]> {
  const out = new Map<T, A11yHint[]>();
  const groups = new Map<string, T[]>();
  for (const e of elements) {
    const isLink = (e.role || e.label.split(' ')[0]) === 'link';
    const href = e.attrs?.href;
    if (!isLink || href === undefined || !hasAccessibleName(e)) continue;
    const k = e.name!.toLowerCase();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(e);
  }
  for (const group of groups.values()) {
    const hrefs = new Set(group.map((e) => e.attrs!.href));
    if (hrefs.size < 2) continue;
    for (const e of group) {
      const others = group.filter((o) => o !== e && o.attrs!.href !== e.attrs!.href).length;
      out.set(e, [
        {
          rule: 'duplicate-name',
          message: `${others} other link${others === 1 ? '' : 's'} named "${e.name}" go${others === 1 ? 'es' : ''} somewhere else: make the names describe their targets`,
        },
      ]);
    }
  }
  return out;
}

/** Sets `a11yHints` on elements (only when there are any) and hint counts on routes and the summary (in place). */
export function addA11yHints(summary: CoverageSummary): void {
  let total = 0;
  for (const r of summary.routes) {
    // The <a> elements of link units too: duplicate names are about links.
    const elements = allElements(r);
    const dupes = duplicateNameHints(elements);
    let count = 0;
    for (const e of elements) {
      const hints = [...elementHints(e), ...(dupes.get(e) ?? [])];
      if (hints.length) e.a11yHints = hints;
      else delete e.a11yHints;
      count += hints.length;
    }
    r.a11yHints = count;
    total += count;
  }
  summary.a11yHints = total;
}
