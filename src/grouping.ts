/**
 * Element grouping, per view (docs "Element grouping"). Runs on resolved
 * data before `aggregate` counts elements: it rewrites the keys of group
 * members to the group's key, so a group is one element (counted once,
 * tested when any member is). Pure.
 *
 * Precedence, per element: `data-uicov-group` → `elementGroups` → automatic
 * heuristics (form boundary, table rows, repeated structures, labels). The
 * hints come from `Resolver.groupHints` (`model/resolve.ts`); the heuristics
 * need the whole view because they only group 2 or more elements.
 */
import type { TestEntry } from './aggregate';
import type { GroupHints, GroupLevel, GroupReason, Interaction, InventoryElement, TestCoverageData } from './types';

/** How an element of the report was grouped (`group` in coverage.json). */
export interface ElementGroup {
  /** The group's name: `data-uicov-group` value or `elementGroups` name. Explicit groups only. */
  name?: string;
  reason: GroupReason;
  /** Number of distinct elements (keys before grouping) merged into it. */
  members: number;
}

type Occurrence = { item: InventoryElement | Interaction; inventory: boolean };

/** One element before grouping: a key (after the form split) and the hints of its occurrences. */
interface Unit {
  key: string;
  hints?: GroupHints;
  /** Keys before the form split. */
  original: string;
  hintsFrom?: 'inventory' | 'interaction';
}

export interface GroupingResult {
  tests: TestEntry[];
  /** Per view: group key → how it was grouped. */
  groups: Map<string, Map<string, ElementGroup>>;
}

/**
 * A key for a repeated-structure group: from the deepest ancestor whose
 * identity all members share (else the top), positional steps with an index
 * only where all members agree.
 */
export function repeatedKey(members: GroupLevel[][]): string {
  const first = members[0];
  let start = -1;
  for (let i = first.length - 1; i >= 0 && start < 0; i--) {
    const a = first[i].anchor;
    if (a && members.every((m) => m[i]?.anchor === a)) start = i;
  }
  let out = start >= 0 ? first[start].anchor! : '';
  for (let i = start + 1; i < first.length; i++) {
    const same = members.every((m) => m[i]?.step === first[i].step);
    out += (out ? first[i].sep : '') + (same ? first[i].step : first[i].tag);
  }
  return out;
}

export function applyGrouping(tests: TestEntry[], viewOf: (url: string, view?: string) => string | undefined): GroupingResult {
  const views = new Map<string, Occurrence[]>();
  const add = (view: string | undefined, o: Occurrence) => {
    if (view === undefined) return;
    if (!views.has(view)) views.set(view, []);
    views.get(view)!.push(o);
  };
  for (const { data } of tests) {
    for (const snap of data.snapshots) for (const item of snap.elements) add(viewOf(snap.url, data.view), { item, inventory: true });
    for (const item of data.interactions) add(viewOf(item.url, data.view), { item, inventory: false });
  }

  const newKey = new Map<InventoryElement | Interaction, string>();
  const joinedItems = new Set<InventoryElement | Interaction>();
  const groups = new Map<string, Map<string, ElementGroup>>();
  for (const [view, occs] of views) {
    const info = new Map<string, { name?: string; reason: GroupReason; members: Set<string> }>();
    const note = (key: string, reason: GroupReason, member: string, name?: string) => {
      if (!info.has(key)) info.set(key, { ...(name ? { name } : {}), reason, members: new Set() });
      info.get(key)!.members.add(member);
    };

    // Explicit groups apply per occurrence, as-is.
    const rest: Occurrence[] = [];
    for (const o of occs) {
      const ex = o.item.grouping?.explicit;
      if (ex) {
        newKey.set(o.item, ex.key);
        note(ex.key, ex.reason, o.item.key, ex.name);
      } else rest.push(o);
    }

    // Form boundary: a key seen in different forms (or in and out of one) is one element per form.
    const forms = new Map<string, Set<string>>();
    for (const o of rest) {
      if (!forms.has(o.item.key)) forms.set(o.item.key, new Set());
      forms.get(o.item.key)!.add(o.item.grouping?.form ?? '');
    }
    const units = new Map<string, Unit>();
    const unitOf = new Map<Occurrence, Unit>();
    for (const o of rest) {
      const form = o.item.grouping?.form;
      const key = form && forms.get(o.item.key)!.size > 1 ? `${form} ${o.item.key}` : o.item.key;
      let u = units.get(key);
      if (!u) units.set(key, (u = { key, original: o.item.key }));
      // The first inventory's hints, else the first interaction's (names can change on interaction).
      if (!u.hintsFrom || (o.inventory && u.hintsFrom === 'interaction')) {
        u.hints = o.item.grouping;
        u.hintsFrom = o.inventory ? 'inventory' : 'interaction';
      }
      unitOf.set(o, u);
    }

    const final = new Map<Unit, string>();
    const joined = new Set<Unit>();
    const assign = (members: Unit[], key: string, reason: GroupReason) => {
      for (const u of members) {
        final.set(u, key);
        note(key, reason, u.key);
      }
    };
    const byHint = (pick: (h: GroupHints) => string | undefined) => {
      const m = new Map<string, Unit[]>();
      for (const u of units.values()) {
        if (final.has(u) || !u.hints || u.hints.none) continue;
        const v = pick(u.hints);
        if (v === undefined) continue;
        if (!m.has(v)) m.set(v, []);
        m.get(v)!.push(u);
      }
      return m;
    };

    // Rows: the same column of a table or grid. One unit (e.g. a shared data-testid) keeps its key.
    for (const [rowKey, members] of byHint((h) => h.row))
      assign(members, members.length > 1 ? rowKey : members[0].key, 'row');
    // Repeated structures: 2+ elements with the same shape and name.
    for (const members of byHint((h) => h.repeated?.sig).values()) {
      if (members.length < 2) continue;
      assign(members, repeatedKey(members.map((u) => u.hints!.repeated!.levels)), 'repeated');
    }
    // Labels: into their control's element, when the control is in this view.
    const byOriginal = new Map<string, Unit>();
    for (const u of units.values()) if (!byOriginal.has(u.original)) byOriginal.set(u.original, u);
    for (const [control, labels] of byHint((h) => h.label)) {
      const target = units.get(control) ?? byOriginal.get(control);
      if (!target || labels.includes(target)) continue;
      const key = final.get(target) ?? target.key;
      if (!final.has(target)) note(key, 'label', target.key);
      assign(labels, key, 'label');
      for (const u of labels) joined.add(u);
    }

    for (const o of rest) {
      const u = unitOf.get(o)!;
      const key = final.get(u) ?? u.key;
      if (key !== o.item.key) newKey.set(o.item, key);
      if (joined.has(u)) joinedItems.add(o.item);
    }
    groups.set(
      view,
      new Map([...info].map(([k, g]) => [k, { ...(g.name ? { name: g.name } : {}), reason: g.reason, members: g.members.size }])),
    );
  }

  const rekey = <T extends InventoryElement | Interaction>(item: T): T => {
    const key = newKey.get(item);
    if (key === undefined) return item;
    return joinedItems.has(item) ? { ...item, key, grouping: { ...item.grouping, joined: true } } : { ...item, key };
  };
  const out = tests.map((t) => {
    const data: TestCoverageData = {
      ...t.data,
      snapshots: t.data.snapshots.map((s) => ({ ...s, elements: s.elements.map(rekey) })),
      interactions: t.data.interactions.map(rekey),
    };
    return { ...t, data };
  });
  return { tests: out, groups };
}
