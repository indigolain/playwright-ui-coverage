/**
 * Turns raw recordings into coverage data: report-time filtering
 * (`ignoreSelectors`) and element identity. Pure: no I/O, no browser. Used by
 * the reporter, the `report` CLI and (with recording-time rules) the
 * recorder's screenshot de-duplication.
 *
 * Identity, in order: `data-uicov-id` → identity attributes
 * (`significantAttributes`, then built-in test ids) → `id` → `name` →
 * structural `tag:nth-of-type(n)` path up to the nearest identified ancestor.
 * Elements in frames and shadow trees are prefixed by their host's key and `>>`.
 */
import type { GroupHints, GroupLevel, Interaction, InventoryElement, Snapshot, TestCoverageData } from '../types';
import { inputType, roleOf } from './elements';
import { READABLE_RECORDING_FORMAT_VERSIONS, type RawCoverageData, type RawElementRef, type RawNode } from './raw';
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
  ignore: CompiledSelector[];
  autoGroup: Required<AutoGroupOptions>;
  groups: { rule: ElementGroupRule; selector: CompiledSelector }[];
}

export function compileRules(rules: UiCoverageRules): CompiledRules {
  return {
    identityAttributes: identityAttributes(rules),
    filters: compileAttributeFilters(rules),
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
const withoutDigits = (s: string) => s.replace(/\d+/g, '#');
type Level = { node: Node; sep: string };
const DETAIL_ATTRS = new Set(['id', 'name', 'role', 'type', 'aria-label', 'href', 'tabindex', 'contenteditable']);
const directive = (n: Node) => (n.attrs['data-uicov-interactive'] ?? '').trim().toLowerCase();

/** Resolves elements of one recording (shares its node table and memoizes keys). */
export class Resolver {
  private nodes: Node[] = [];
  private keys = new Map<Node, string>();
  private ignored = new Map<Node, boolean>();
  private ids?: { size: number; byTree: Map<Node, Map<string, Node>> };
  private hints = new Map<Node, { hints?: GroupHints; shape?: { sig: string; levels: GroupLevel[] } }>();

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
    return this.nodes[ref.node];
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
   * Grouping facts for `grouping.ts` (README "Element grouping"). Explicit
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
    const grouping = this.groupHints(ref, node);
    return {
      key: this.key(node),
      label: this.label(ref, node),
      attrs,
      role: roleOf(node),
      name: ref.name ?? '',
      nameFrom: ref.nameFrom ?? '',
      ...(frames.length ? { frames } : {}),
      ...(grouping ? { grouping } : {}),
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

  const snapshots: Snapshot[] = data.snapshots.map((snap) => {
    const elements: InventoryElement[] = [];
    for (const el of snap.elements) {
      const node = r.node(el);
      if (!node || el.candidateOnly || r.isIgnored(node)) continue;
      elements.push({
        ...r.describe(el, node),
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
    return out;
  });

  const interactions: Interaction[] = [];
  for (const i of data.interactions) {
    const node = r.node(i.element);
    if (!node || r.isIgnored(node)) continue;
    interactions.push({ ...r.describe(i.element, node), event: i.event, url: i.url });
  }
  return { interactions, snapshots, ...(data.componentTest ? { componentTest: true } : {}) };
}
