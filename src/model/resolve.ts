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
import type { Interaction, InventoryElement, Snapshot, TestCoverageData } from '../types';
import { inputType, roleOf } from './elements';
import { READABLE_RECORDING_FORMAT_VERSIONS, type RawCoverageData, type RawElementRef, type RawNode } from './raw';
import {
  compileAttributeFilters,
  compileRuleSelector,
  identityAttributes,
  mergeRules,
  UICOV_ID_ATTRIBUTE,
  type CompiledAttributeFilter,
  type UiCoverageRules,
} from './rules';
import { DOCUMENT_TAG, treeParent, type CompiledSelector, type SelectorNode } from './selector';

/** What a `ui-coverage` attachment (or a stored attempt) may contain. */
export type RecordedCoverageData = RawCoverageData | TestCoverageData;

export function isRawData(data: unknown): data is RawCoverageData {
  return typeof data === 'object' && data !== null && typeof (data as any).formatVersion === 'number';
}

export interface CompiledRules {
  identityAttributes: string[];
  filters: CompiledAttributeFilter[];
  ignore: CompiledSelector[];
}

export function compileRules(rules: UiCoverageRules): CompiledRules {
  return {
    identityAttributes: identityAttributes(rules),
    filters: compileAttributeFilters(rules),
    // data-uicov-ignore is an alias too; the browser already applied it, this keeps both consistent.
    ignore: ['[data-uicov-ignore]', ...uniqueBy(rules.ignoreSelectors ?? [], (s) => JSON.stringify(s))].map(
      compileRuleSelector,
    ),
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
const isRow = (n: Node) => n.tag === 'tr' || n.attrs.role === 'row';
const DETAIL_ATTRS = new Set(['id', 'name', 'role', 'type', 'aria-label', 'href', 'tabindex', 'contenteditable']);
const directive = (n: Node) => (n.attrs['data-uicov-interactive'] ?? '').trim().toLowerCase();

/** Resolves elements of one recording (shares its node table and memoizes keys). */
export class Resolver {
  private nodes: Node[] = [];
  private keys = new Map<Node, string>();
  private ignored = new Map<Node, boolean>();

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
   * repeated data, so they get no index.
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
      if (cur.parent && !isRow(cur) && cur.of > 1) step += `:nth-of-type(${cur.nth})`;
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
    return {
      key: this.key(node),
      label: this.label(ref, node),
      attrs,
      role: roleOf(node),
      name: ref.name ?? '',
      nameFrom: ref.nameFrom ?? '',
      ...(frames.length ? { frames } : {}),
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
