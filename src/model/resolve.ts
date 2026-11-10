/**
 * Turns raw recordings into coverage data: report-time filtering
 * (`elementFilters`, the deprecated `ignoreSelectors`), named elements
 * (`elements`) and element identity. Pure: no I/O, no browser. Used by
 * the reporter, the `report` CLI and (with recording-time rules) the
 * recorder's screenshot de-duplication.
 *
 * Identity, in order: a matching `elements` rule → `data-uicov-id` → identity attributes
 * (`significantAttributes`, then built-in test ids) → `id` → `name` →
 * structural `tag:nth-of-type(n)` path up to the nearest identified ancestor.
 * Elements in frames and shadow trees are prefixed by their host's key and `>>`.
 */
import type { GroupHints, GroupLevel, Interaction, InventoryElement, Snapshot, Step, TestCoverageData } from '../types';
import { inputType, roleOf } from './elements';
import {
  READABLE_RECORDING_FORMAT_VERSIONS,
  type RawCoverageData,
  type RawElement,
  type RawElementRef,
  type RawInteraction,
  type RawNode,
  type RawSnapshot,
} from './raw';
import {
  autoGroupSwitches,
  compileAttributeFilters,
  compileRuleSelector,
  identityAttributes,
  mergeRules,
  UICOV_ID_ATTRIBUTE,
  UICOV_GROUP_ATTRIBUTE,
  type AutoGroupOptions,
  type CompiledAttributeFilter,
  type ElementGroupRule,
  type UiCoverageRules,
} from './rules';
import { DOCUMENT_TAG, isBoundary, treeParent, type CompiledSelector, type SelectorNode } from './selector';

/** What a `ui-coverage` attachment (or a stored attempt) may contain. */
export type RecordedCoverageData = RawCoverageData | TestCoverageData;

export function isRawData(data: unknown): data is RawCoverageData {
  return typeof data === 'object' && data !== null && typeof (data as any).formatVersion === 'number';
}

export interface CompiledRules {
  identityAttributes: string[];
  filters: CompiledAttributeFilter[];
  /** `elementFilters`, in order. */
  elementFilters: { selector: CompiledSelector; include: boolean }[];
  /** `elements` rules, in order (the last applicable one wins). */
  named: { selector: CompiledSelector; key: string; label?: string }[];
  /** `[data-uicov-ignore]` and `ignoreSelectors`, checked on the element and its ancestors. */
  ignore: CompiledSelector[];
  autoGroup: Required<AutoGroupOptions>;
  groups: { rule: ElementGroupRule; selector: CompiledSelector }[];
}

export function compileRules(rules: UiCoverageRules): CompiledRules {
  return {
    identityAttributes: identityAttributes(rules),
    filters: compileAttributeFilters(rules),
    elementFilters: (rules.elementFilters ?? []).map((f) => ({
      selector: compileRuleSelector({ selector: f.selector, documentScope: f.documentScope }),
      include: !!f.include,
    })),
    named: (rules.elements ?? []).map((e) => {
      const name = e.name?.trim();
      return {
        selector: compileRuleSelector({ selector: e.selector, documentScope: e.documentScope }),
        key: name || (e.documentScope ? `${e.documentScope} >> ${e.selector}` : e.selector),
        ...(name ? { label: name } : {}),
      };
    }),
    // data-uicov-ignore is an alias too; the browser already applied it, this keeps both consistent.
    ignore: ['[data-uicov-ignore]', ...uniqueBy(rules.ignoreSelectors ?? [], (s) => JSON.stringify(s))].map(
      compileRuleSelector,
    ),
    autoGroup: autoGroupSwitches(rules),
    groups: (rules.elementGroups ?? []).map((rule) => ({
      rule,
      selector: compileRuleSelector(
        rule.documentScope === undefined ? rule.selector : { selector: rule.selector, documentScope: rule.documentScope },
      ),
    })),
  };
}

function uniqueBy<T>(items: T[], id: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((t) => !seen.has(id(t)) && !!seen.add(id(t)));
}

interface Node extends SelectorNode {
  parent?: Node;
}

const quote = (v: string) => JSON.stringify(v);
/** The top element of the node's tree: `<html>`, or a shadow root's top-level element. Its parent, if any, is a boundary. */
const treeTop = (n: Node): Node => {
  let top = n;
  for (let p = treeParent(top); p; p = treeParent(top)) top = p;
  return top;
};
const firstRole = (n: Node) => (n.attrs.role ?? '').trim().toLowerCase().split(/\s+/)[0];
const isRow = (n: Node) => n.tag === 'tr' || n.attrs.role === 'row';
const ROW_SECTIONS = new Set(['tbody', 'thead', 'tfoot']);
/** The parent element, across shadow roots and frames (skipping their boundary nodes). */
const up = (n: Node): Node | undefined => (n.parent && isBoundary(n.parent) ? n.parent.parent : n.parent);
const isRowContainer = (n: Node) => n.tag === 'table' || ['grid', 'table', 'treegrid'].includes(firstRole(n));
const isForm = (n: Node) => n.tag === 'form' || firstRole(n) === 'form';
/**
 * Links aren't grouped by the row and repeated-structure heuristics: links
 * are grouped by their destination instead (hook: handled outside of them).
 */
const isLink = (n: Node) => (n.tag === 'a' || n.tag === 'area') && n.attrs.href !== undefined;
/** Containers whose items are distinct choices: the repeated-structure heuristic stays out of them. */
const isNavigation = (n: Node) =>
  n.tag === 'nav' ||
  n.tag === 'menu' ||
  ['navigation', 'menu', 'menubar', 'tablist', 'toolbar', 'radiogroup', 'listbox', 'tree'].includes(firstRole(n));
const LABELABLE = new Set(['input', 'select', 'textarea', 'button', 'meter', 'output', 'progress']);
/** Class tokens that describe the shape (tokens with digits are usually per-instance), sorted. */
const classShape = (n: Node) =>
  [...new Set((n.attrs.class ?? '').split(/\s+/).filter((c) => c && !/\d/.test(c)))]
    .sort()
    .map((c) => `.${c}`)
    .join('');
const classSet = (n: Node) => new Set((n.attrs.class ?? '').split(/\s+/).filter((c) => c && !/\d/.test(c)));
const withoutDigits = (s: string) => s.replace(/\d+/g, '#');
/** An identity that names one record rather than a kind of element: it has digits, as in the grouping heuristics. */
const isRecordId = (id: string) => /\d/.test(id);
type Level = { node: Node; sep: string };
const DETAIL_ATTRS = new Set(['id', 'name', 'role', 'type', 'aria-label', 'href', 'tabindex', 'contenteditable']);
const directive = (n: Node) => (n.attrs['data-uicov-interactive'] ?? '').trim().toLowerCase();

/** Resolves elements of one recording (shares its node table and memoizes keys). */
export class Resolver {
  private nodes: Node[] = [];
  private keys = new Map<Node, string>();
  private ignored = new Map<Node, boolean>();
  private excluded = new Map<Node, boolean>();
  /** Elements pinned by an `elements` rule (see `pinNamedElements`). */
  private pins = new Map<Node, { key: string; label?: string }>();
  private ids?: { size: number; byTree: Map<Node, Map<string, Node>> };
  private hints = new Map<Node, { hints?: GroupHints; shape?: { sig: string; levels: GroupLevel[] } }>();
  private paths = new Map<Node, string>();
  /** Accessible names each node was recorded with (digits ignored), as `node` sees them. */
  private names = new Map<Node, Set<string>>();

  /**
   * `data.nodes` may grow after construction (the recorder appends to it);
   * new nodes are picked up on access. Parents must come before children.
   */
  constructor(
    private data: Pick<RawCoverageData, 'nodes'>,
    private rules: CompiledRules,
  ) {}

  node(ref: RawElementRef): Node | undefined {
    const raw = this.data.nodes;
    for (let i = this.nodes.length; i < raw.length; i++) {
      const n: RawNode = raw[i];
      const node: Node = { tag: n.tag, attrs: n.attrs ?? {}, nth: n.nth ?? 1, of: n.of ?? 1 };
      if (n.parent !== undefined) node.parent = this.nodes[n.parent];
      this.nodes.push(node);
    }
    const node = this.nodes[ref.node];
    const name = ref.name?.trim();
    if (node && name) {
      if (!this.names.has(node)) this.names.set(node, new Set());
      this.names.get(node)!.add(withoutDigits(name));
    }
    return node;
  }

  /**
   * Excluded at report time? The first `elementFilters` rule whose selector
   * matches the element itself decides; without one, `isIgnored` (the
   * deprecated `ignoreSelectors` and `data-uicov-ignore`).
   */
  isExcluded(node: Node): boolean {
    let r = this.excluded.get(node);
    if (r !== undefined) return r;
    const f = this.rules.elementFilters.find((f) => f.selector.matches(node));
    r = f ? !f.include : this.isIgnored(node);
    this.excluded.set(node, r);
    return r;
  }

  /**
   * Applies the `elements` rules to one recording. A rule pins an element
   * when its selector matches it and, in every snapshot showing it, no other
   * counted element; an element only seen in interactions is pinned when the
   * selector matches it. When several rules pin an element, the last one wins.
   */
  pinNamedElements(snapshots: { elements: RawElement[] }[], interactions: RawInteraction[]): void {
    if (!this.rules.named.length) return;
    const counted = (el: RawElement) => {
      const node = this.node(el);
      return node && !el.candidateOnly && !this.isExcluded(node) ? node : undefined;
    };
    const shown = snapshots.map((snap) => snap.elements.map(counted).filter((n): n is Node => !!n));
    const inSnapshots = new Set(shown.flat());
    for (const rule of this.rules.named) {
      const ok = new Set<Node>();
      const ambiguous = new Set<Node>();
      for (const nodes of shown) {
        const matches = nodes.filter((n) => rule.selector.matches(n));
        if (matches.length === 1) ok.add(matches[0]);
        else matches.forEach((n) => ambiguous.add(n));
      }
      for (const i of interactions) {
        const node = this.node(i.element);
        if (node && !inSnapshots.has(node) && rule.selector.matches(node)) ok.add(node);
      }
      for (const node of ok) if (!ambiguous.has(node)) this.pins.set(node, { key: rule.key, label: rule.label });
    }
  }

  /**
   * Excluded by `ignoreSelectors` (or `data-uicov-ignore`)? Same semantics as
   * in the browser, where they're aliases of `data-uicov-interactive="exclude-all"`:
   * the closest element (self or ancestor) with a directive decides, `reset`
   * stops the exclusion, and the element's own `include` beats it.
   */
  isIgnored(node: Node): boolean {
    let r = this.ignored.get(node);
    if (r !== undefined) return r;
    r = false;
    for (let cur: Node | undefined = node; cur; cur = cur.parent) {
      const d = directive(cur);
      if (d === 'reset') break;
      if (d === 'exclude-all') {
        r = true;
        break;
      }
      if (d === 'include' || d === 'exclude') {
        if (cur === node) break; // own directive wins (exclude: wasn't recorded as interactive anyway)
        continue; // only applies to that element
      }
      if (this.rules.ignore.some((s) => s.matches(cur!))) {
        r = true;
        break;
      }
    }
    this.ignored.set(node, r);
    return r;
  }

  /** The first value the attribute filters let through decides; no match means usable. */
  private usable(attr: string, value: string): boolean {
    if (!value.trim()) return false;
    for (const f of this.rules.filters) {
      if (f.attribute.test(attr) && (!f.value || f.value.test(value))) return f.include;
    }
    return true;
  }

  /** Attribute-based identity of `n`, or '' if it has none. */
  private identityOf(n: Node): string {
    const explicit = n.attrs[UICOV_ID_ATTRIBUTE];
    if (explicit && explicit.trim()) return explicit.trim();
    for (const attr of this.rules.identityAttributes) {
      const v = n.attrs[attr];
      if (v !== undefined && this.usable(attr, v)) return `[${attr}=${quote(v)}]`;
    }
    const id = n.attrs.id;
    if (id && this.usable('id', id)) return /^[A-Za-z_][\w-]*$/.test(id) ? `#${id}` : `[id=${quote(id)}]`;
    const name = n.attrs.name;
    if (name && this.usable('name', name)) {
      let key = `[name=${quote(name)}]`;
      // Radio buttons / checkboxes in a group share a name; tell them apart by value.
      const type = inputType(n.attrs);
      const value = n.attrs.value;
      if (n.tag === 'input' && (type === 'radio' || type === 'checkbox') && value) key += `[value=${quote(value)}]`;
      return key;
    }
    return '';
  }

  /**
   * Structural fallback: `tag:nth-of-type(n)` steps (index only when there are
   * same-tag siblings) up to the nearest ancestor that has an identity, or up
   * to <body> (in a shadow tree: up to its top-level element). Table rows are
   * repeated data, so they get no index (unless `autoGroup.rows` is off).
   */
  private structuralKey(el: Node): string {
    const steps: string[] = [];
    let cur: Node | undefined = el;
    while (cur && cur.tag !== 'body' && cur.tag !== 'html') {
      if (cur !== el) {
        const anchor = this.identityOf(cur);
        if (anchor) {
          steps.unshift(cur.attrs[UICOV_ID_ATTRIBUTE] !== undefined ? `[data-uicov-id=${quote(anchor)}]` : anchor);
          break;
        }
      }
      let step = cur.tag;
      if (cur.parent && (!isRow(cur) || !this.rules.autoGroup.rows) && cur.of > 1) step += `:nth-of-type(${cur.nth})`;
      steps.unshift(step);
      cur = treeParent(cur);
    }
    return steps.join(' > ');
  }

  /**
   * The element's key: its identity (or structural key) in its own tree,
   * prefixed by the key of the tree's host (`<iframe>` or shadow host) and
   * ` >> `, recursively: `iframe[data-testid="pay"] >> [data-testid="card"]`.
   * A `data-uicov-id` value is used as-is, without a prefix.
   */
  key(node: Node): string {
    let k = this.keys.get(node);
    if (k === undefined) {
      const explicit = node.attrs[UICOV_ID_ATTRIBUTE]?.trim();
      if (explicit) k = explicit;
      else {
        k = this.identityOf(node) || this.structuralKey(node);
        const boundary = treeTop(node).parent;
        if (boundary) k = `${boundary.parent ? this.key(boundary.parent) : boundary.tag} >> ${k}`;
      }
      this.keys.set(node, k);
    }
    return k;
  }

  /**
   * The chain from below `from` (exclusive; undefined: from the top document)
   * down to `el`, without `<html>`/`<body>`. A level at the top of a shadow
   * root or frame document gets the ` >> ` separator.
   */
  private levels(el: Node, from?: Node): Level[] {
    const out: Level[] = [];
    for (let n: Node | undefined = el; n && n !== from; n = n.parent) {
      if (isBoundary(n)) {
        if (out.length) out[out.length - 1].sep = ' >> ';
        continue;
      }
      if (n.tag === 'html' || n.tag === 'body') continue;
      out.push({ node: n, sep: ' > ' });
    }
    return out.reverse();
  }

  /** Positional steps (`tag:nth-of-type(n)`, rows without an index), each after its separator. */
  private path(levels: Level[]): string {
    return levels.map((l) => l.sep + this.step(l.node)).join('');
  }

  private step(n: Node): string {
    return n.of > 1 && !isRow(n) ? `${n.tag}:nth-of-type(${n.nth})` : n.tag;
  }

  /**
   * Grouping facts for `grouping.ts` (docs "Element grouping"). Explicit
   * groups come first: the closest `data-uicov-group` (self or ancestor, also
   * across frames and shadow roots; an empty value turns grouping off), then
   * the first `elementGroups` entry matching the element or an ancestor.
   * Their keys are used as-is, without a host prefix (like `data-uicov-id`):
   * `[data-uicov-group="name"]`, or the entry's selector.
   */
  groupHints(ref: RawElementRef, node: Node): GroupHints | undefined {
    let cached = this.hints.get(node);
    if (!cached) this.hints.set(node, (cached = this.structuralHints(node)));
    const { hints, shape } = cached;
    // The accessible name is per snapshot; the rest only depends on the node.
    const name = ref.name?.trim();
    if (!shape || !name || ref.nameFrom === 'name') return hints;
    return { ...hints, repeated: { sig: `${shape.sig} ${quote(name)}`, levels: shape.levels } };
  }

  private structuralHints(node: Node): { hints?: GroupHints; shape?: { sig: string; levels: GroupLevel[] } } {
    for (let n: Node | undefined = node; n; n = n.parent) {
      const v = n.attrs[UICOV_GROUP_ATTRIBUTE];
      if (v === undefined) continue;
      const name = v.trim();
      if (!name) return { hints: { none: true } };
      return { hints: { explicit: { key: `[${UICOV_GROUP_ATTRIBUTE}=${quote(name)}]`, name, reason: 'markup' } } };
    }
    for (const { rule, selector } of this.rules.groups) {
      for (let n: Node | undefined = node; n; n = n.parent) {
        if (isBoundary(n) || !selector.matches(n)) continue;
        if (rule.exclude) return { hints: { none: true } };
        const key = rule.documentScope ? `${rule.documentScope} >> ${rule.selector}` : rule.selector;
        return { hints: { explicit: { key, name: rule.name?.trim() || key, reason: 'config' } } };
      }
    }

    const sw = this.rules.autoGroup;
    const hints: GroupHints = {};
    const explicitId = !!node.attrs[UICOV_ID_ATTRIBUTE]?.trim();
    if (sw.forms && !explicitId) {
      for (let n = treeParent(node); n; n = treeParent(n))
        if (isForm(n)) {
          hints.form = this.key(n);
          break;
        }
    }
    // data-uicov-id is an explicit identity: never grouped automatically.
    const auto = !explicitId && !isLink(node);
    const row = auto && sw.rows ? this.rowKey(node) : undefined;
    if (row) hints.row = row;
    const shape = auto && sw.repeated && !row ? this.repeatedShape(node) : undefined;
    if (sw.labels && node.tag === 'label') {
      const control = this.controlOf(node);
      if (control) hints.label = this.key(control);
    }
    return { ...(Object.keys(hints).length ? { hints } : {}), ...(shape ? { shape } : {}) };
  }

  /**
   * In a row (`<tr>`, `role=row`) of a table or grid: the table's key and the
   * position below it, rows without an index and identities ignored, so the
   * same column of every row gives the same value.
   */
  private rowKey(node: Node): string | undefined {
    let row: Node | undefined;
    for (let n: Node | undefined = node; n && !row; n = treeParent(n)) if (isRow(n)) row = n;
    if (!row) return undefined;
    let table: Node | undefined;
    for (let n = treeParent(row); n && !table; n = treeParent(n)) if (isRowContainer(n)) table = n;
    if (!table) return undefined;
    return this.key(table) + this.path(this.levels(node, table));
  }

  /**
   * The shape of the element and its ancestors (tag and classes; forms also
   * by their identity and action; the element also by its identity with
   * digits ignored), plus role and accessible name. Elements with the same
   * shape in repeated sibling structures (cards, list items) are grouped.
   * Conservative: needs an accessible name (added by `groupHints`), and not
   * inside navigation.
   */
  private repeatedShape(node: Node): { sig: string; levels: GroupLevel[] } | undefined {
    for (let n = node.parent; n; n = n.parent) if (!isBoundary(n) && isNavigation(n)) return undefined;
    const levels: GroupLevel[] = [];
    let sig = '';
    for (const { node: n, sep } of this.levels(node)) {
      const identity = this.identityOf(n);
      let shape = n.tag + classShape(n);
      if (isForm(n)) shape += `{${withoutDigits(identity)}|${n.attrs.action ?? ''}}`;
      else if (n === node && identity) shape += `{${withoutDigits(identity)}}`;
      sig += sep + shape;
      const anchor = identity && n.attrs[UICOV_ID_ATTRIBUTE] !== undefined ? `[data-uicov-id=${quote(identity)}]` : identity;
      levels.push({ step: this.step(n), tag: n.tag, ...(anchor ? { anchor } : {}), sep });
    }
    return { sig: `${sig} ${roleOf(node)}`, levels };
  }

  /** The labelable element a `<label>` is for (`for`, else the first one inside it), if recorded. */
  private controlOf(label: Node): Node | undefined {
    const top = treeTop(label);
    const forId = label.attrs.for;
    if (forId !== undefined) {
      if (!this.ids || this.ids.size !== this.nodes.length) {
        const byTree = new Map<Node, Map<string, Node>>();
        for (const n of this.nodes) {
          if (n.attrs.id === undefined || isBoundary(n)) continue;
          const t = treeTop(n);
          if (!byTree.has(t)) byTree.set(t, new Map());
          if (!byTree.get(t)!.has(n.attrs.id)) byTree.get(t)!.set(n.attrs.id, n);
        }
        this.ids = { size: this.nodes.length, byTree };
      }
      const n = this.ids.byTree.get(top)?.get(forId);
      return n && LABELABLE.has(n.tag) ? n : undefined;
    }
    for (const n of this.nodes) {
      if (!LABELABLE.has(n.tag) || (n.tag === 'input' && inputType(n.attrs) === 'hidden')) continue;
      for (let p = treeParent(n); p; p = treeParent(p)) if (p === label) return n;
    }
    return undefined;
  }

  /**
   * Where this one element is in the page: every level from the top document
   * down, by its identity when that names one record (has digits: `tr#user-2`),
   * else by its identity if any and its position among same-tag siblings
   * (`li[data-testid="todo-item"]:2`). Unlike keys it tells instances apart
   * (the "Delete" of row 2 and of row 3), so a step can be matched to its box
   * in a screenshot; a record's identity keeps it from matching another
   * record that moved into its place.
   */
  instancePath(node: Node): string {
    let p = this.paths.get(node);
    if (p === undefined) {
      const id = isBoundary(node) ? '' : this.identityOf(node);
      const own = isRecordId(id) ? `${node.tag}${id}` : `${node.tag}${id}${node.of > 1 ? `:${node.nth}` : ''}`;
      p = node.parent ? `${this.instancePath(node.parent)}/${own}` : own;
      this.paths.set(node, p);
    }
    return p;
  }

  /**
   * Which of several repeated elements this is. `hint`, for people: its rows
   * in tables or grids, outermost first (`row 2 of 3 · #order-7 › row 1`),
   * else the repeated item it is or is in (`item 2 of 3`), then the element's
   * own identity; identities only when they name one record (have digits, as
   * in the grouping heuristics: `[data-testid="todo-item"]` on every item
   * tells nothing). `anchored`: a row, the item or the element has such an
   * identity, so its box can be told from another record's that took its
   * place (a deleted, sorted or recycled row). Crosses shadow roots and
   * frames, like the grouping.
   */
  instance(node: Node, name?: string): { hint?: string; anchored: boolean } {
    const parts: string[] = [];
    let anchored = false;
    let itemId = '';
    const rows: Node[] = [];
    for (let n: Node | undefined = node; n; n = up(n)) if (isRow(n)) rows.unshift(n);
    if (rows.length) {
      const described = rows.map((r) => this.rowHint(r)).filter((h) => h);
      if (described.length) parts.push(described.join(' › '));
      anchored = rows.some((r) => isRecordId(this.identityOf(r)));
    } else {
      const item = this.repeatedItem(node, name);
      if (item) {
        const id = this.identityOf(item);
        itemId = isRecordId(id) ? id : '';
        anchored = !!itemId;
        parts.push([`item ${item.nth} of ${item.of}`, itemId].filter((x) => x).join(' · '));
      }
    }
    const ownId = this.identityOf(node);
    if (isRecordId(ownId)) {
      anchored = true;
      if (ownId !== itemId) parts.push(ownId);
    }
    return { ...(parts.length ? { hint: parts.join(' · ') } : {}), anchored };
  }

  /**
   * One row: `aria-rowindex` (and the grid's `aria-rowcount`) when set, as
   * virtualized grids do. Else, for a `<tr>`, its position when it can be
   * trusted: in the only `<tbody>` (or `<thead>`, `<tfoot>`) of its table,
   * not one of several, where positions restart. A `role=row` gets none: its
   * same-tag siblings can be spacers or panels, which aren't recorded. Then
   * its identity when it names one record.
   */
  private rowHint(row: Node): string {
    let pos = '';
    const index = row.attrs['aria-rowindex']?.trim();
    if (index && /^\d+$/.test(index)) {
      let grid: Node | undefined;
      for (let n = up(row); n && !grid; n = up(n)) if (isRowContainer(n)) grid = n;
      const count = grid?.attrs['aria-rowcount']?.trim();
      pos = `row ${index}${count && /^\d+$/.test(count) ? ` of ${count}` : ''}`;
    } else if (row.tag === 'tr') {
      const section = treeParent(row);
      if (section && (isRowContainer(section) || (ROW_SECTIONS.has(section.tag) && section.of === 1)))
        pos = `row ${row.nth}${row.of > 1 ? ` of ${row.of}` : ''}`;
    }
    const id = this.identityOf(row);
    return [pos, isRecordId(id) ? id : ''].filter((x) => x).join(' · ');
  }

  /**
   * The repeated item an element is in (a card, a list item) or is (a star
   * of a rating group): the nearest level with a recorded sibling of the
   * same shape that holds an element of the same shape at the same place
   * (the "Add" of the next card), so wrappers that every card has at the
   * same position (`div.title` + `div.actions`, `div.header > button` +
   * `div.footer > button`) aren't taken for it. Counterparts recorded with
   * the element's accessible name (digits ignored) are looked for first, so
   * a "Favorite" in `div > button` isn't taken for the counterpart of an
   * "Add" in `div > button`; then any (names can name the record: "Add
   * Apple"). The element itself counts only among siblings of its explicit
   * group, and only when no level above it repeats (a rating in each
   * product card: the card). Undefined when nothing repeats.
   */
  private repeatedItem(node: Node, name?: string): Node | undefined {
    const named = name?.trim() ? withoutDigits(name.trim()) : undefined;
    return (named && this.repeatedItemBy(node, named)) || this.repeatedItemBy(node);
  }

  private repeatedItemBy(node: Node, name?: string): Node | undefined {
    const below: Node[] = [];
    let self: Node | undefined;
    for (let n: Node | undefined = node; n; n = up(n)) {
      // The top document's <body>; a frame's goes on to the <iframe> and its item.
      if ((n.tag === 'body' || n.tag === 'html') && !treeTop(n).parent) break;
      if (n === node) {
        // Not next to other controls ("Add to cart" beside "Save for later").
        const group = this.explicitGroup(node);
        if (group && this.nodes.some((m) => m !== node && m.parent === node.parent && m.tag === node.tag && this.explicitGroup(m) === group))
          self = node;
      } else if (n.of > 1 && this.repeatsAt(n, below, name)) return n;
      below.push(n);
    }
    return self;
  }

  /** The key of the explicit group (`data-uicov-group`, `elementGroups`) the element is in, if any. */
  private explicitGroup(node: Node): string | undefined {
    let cached = this.hints.get(node);
    if (!cached) this.hints.set(node, (cached = this.structuralHints(node)));
    return cached.hints?.explicit?.key;
  }

  /**
   * Whether a recorded sibling of `item` like it (`sameShape`) holds a node
   * along the levels `below` (from the element up to `item`, element first;
   * empty when `item` is the element itself), each like its counterpart;
   * with `name`, an element recorded with that accessible name.
   */
  private repeatsAt(item: Node, below: Node[], name?: string): boolean {
    return this.nodes.some((m) => {
      if (name && below.length && !this.names.get(m)?.has(name)) return false;
      let n: Node | undefined = m;
      for (let i = 0; i < below.length; i++) {
        if (!n || !this.sameShape(n, below[i], i === 0)) return false;
        n = up(n);
      }
      return !!n && n !== item && n.parent === item.parent && this.sameShape(n, item, below.length === 0);
    });
  }

  /**
   * Whether two nodes look like the same part of repeated items: same tag,
   * classes (digits ignored, as in the grouping) of one all on the other
   * (which may add a state like `.selected`), and for the element itself the
   * same role. Not identities, which can name the record (`add-apple`).
   */
  private sameShape(a: Node, b: Node, element: boolean): boolean {
    if (a.tag !== b.tag || (element && roleOf(a) !== roleOf(b))) return false;
    const ca = classSet(a);
    const cb = classSet(b);
    const [small, big] = ca.size <= cb.size ? [ca, cb] : [cb, ca];
    for (const c of small) if (!big.has(c)) return false;
    return true;
  }

  /** Keys of the `<iframe>`/`<frame>` elements the node is inside, outermost first. */
  frames(node: Node): string[] {
    const out: string[] = [];
    for (let n = node.parent; n; n = n.parent)
      if (n.tag === DOCUMENT_TAG && n.parent) out.unshift(this.key(n.parent));
    return out;
  }

  /** `role "accessible name"`, display only. */
  label(ref: RawElementRef, node: Node): string {
    const role = roleOf(node);
    return ref.name ? `${role} "${ref.name}"` : role;
  }

  /**
   * Label plus the details `coverage.json` lists per element: role, accessible
   * name and its source, and the identifying attributes (`data-*`, a few
   * common ones and the identity attributes; values capped at 200 chars).
   */
  describe(ref: RawElementRef, node: Node) {
    const attrs: Record<string, string> = {};
    for (const [name, value] of Object.entries(node.attrs)) {
      if (name.startsWith('data-') || DETAIL_ATTRS.has(name) || this.rules.identityAttributes.includes(name))
        attrs[name] = value.slice(0, 200);
    }
    const type = inputType(node.attrs);
    if (node.tag === 'input' && (type === 'radio' || type === 'checkbox') && node.attrs.value !== undefined)
      attrs.value = node.attrs.value.slice(0, 200);
    const frames = this.frames(node);
    const pin = this.pins.get(node);
    const grouping = this.groupHints(ref, node);
    return {
      key: pin?.key ?? this.key(node),
      label: pin?.label ?? this.label(ref, node),
      attrs,
      role: roleOf(node),
      name: ref.name ?? '',
      nameFrom: ref.nameFrom ?? '',
      ...(frames.length ? { frames } : {}),
      ...(pin ? { autoKey: this.key(node) } : {}),
      ...(grouping ? { grouping } : {}),
      ...(ref.href ? { href: ref.href } : {}),
    };
  }
}

/** Applies `rules` (merged with the rules recorded in `data`) to one recording. */
export function resolveCoverageData(
  data: RecordedCoverageData,
  rules: UiCoverageRules = {},
  cache?: Map<string, CompiledRules>,
): TestCoverageData {
  // Pre-0.2 recordings already carry keys and labels computed in the browser.
  if (!isRawData(data)) return data;
  if (!READABLE_RECORDING_FORMAT_VERSIONS.includes(data.formatVersion)) {
    throw new Error(
      `[playwright-ui-coverage] unsupported recording formatVersion ${data.formatVersion} ` +
        `(this version reads ${READABLE_RECORDING_FORMAT_VERSIONS.join(', ')}); update playwright-ui-coverage`,
    );
  }
  const effective = mergeRules(rules, data.rules);
  const cacheKey = JSON.stringify(effective);
  let compiledRules = cache?.get(cacheKey);
  if (!compiledRules) {
    compiledRules = compileRules(effective);
    cache?.set(cacheKey, compiledRules);
  }
  const r = new Resolver(data, compiledRules);
  r.pinNamedElements(data.snapshots, data.interactions);

  const resolveSnapshot = (snap: RawSnapshot): Snapshot => {
    const elements: InventoryElement[] = [];
    for (const el of snap.elements) {
      const node = r.node(el);
      if (!node || el.candidateOnly || r.isExcluded(node)) continue;
      elements.push({
        ...r.describe(el, node),
        instance: r.instancePath(node),
        tag: node.tag,
        x: el.x,
        y: el.y,
        w: el.w,
        h: el.h,
        ...(el.pos ? { pos: el.pos } : {}),
      });
    }
    const out: Snapshot = { url: snap.url, dpr: snap.dpr, elements };
    if (snap.screenshot) out.screenshot = snap.screenshot;
    if (snap.screenshotHeight) out.screenshotHeight = snap.screenshotHeight;
    if (snap.screenshotClip) out.screenshotClip = snap.screenshotClip;
    if (snap.t !== undefined) out.t = snap.t;
    if (snap.hash) out.hash = snap.hash;
    return out;
  };
  const snapshots = data.snapshots.map(resolveSnapshot);

  const interactions: Interaction[] = [];
  for (const i of data.interactions) {
    const node = r.node(i.element);
    if (!node || r.isExcluded(node)) continue;
    interactions.push({ ...r.describe(i.element, node), event: i.event, url: i.url });
  }
  const out: TestCoverageData = { interactions, snapshots };
  if (data.steps) {
    out.steps = data.steps.map((st) => {
      const step: Step = { t: st.t, event: st.event, url: st.url };
      if (st.page !== undefined) step.page = st.page;
      const node = st.element && r.node(st.element);
      if (node && !r.isExcluded(node)) {
        const { key, label, grouping, frames } = r.describe(st.element!, node);
        const { hint, anchored } = r.instance(node, st.element!.name);
        step.target = {
          key,
          label,
          ...(grouping ? { grouping } : {}),
          ...(frames ? { frames } : {}),
          // Matched to a box only when an identity names its record (see `Resolver.instance`).
          ...(anchored ? { instance: r.instancePath(node) } : {}),
          ...(hint ? { hint } : {}),
        };
      } else if (st.element?.name) step.name = st.element.name;
      if (st.call) step.call = st.call;
      if (st.state !== undefined) step.state = st.state;
      return step;
    });
  }
  if (data.states) out.states = data.states.map(resolveSnapshot);
  if (data.componentTest) out.componentTest = true;
  return out;
}
