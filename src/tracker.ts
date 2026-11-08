/**
 * In-page tracker. It records raw facts: every visible candidate element
 * (tag, attributes, same-tag sibling position, ancestors, accessible name,
 * box) and the interactions on them. Identity and filtering are computed in
 * Node from those facts (`model/resolve.ts`), so they can change at report
 * time. Interactivity ("does this element count?") is decided here and
 * recorded as a fact, because it needs the live DOM: computed styles and
 * scroll geometry, descendants (the nesting rule), `label.control`,
 * `isContentEditable`.
 *
 * This function is serialized and injected with `page.addInitScript`, so it
 * must be fully self-contained: no imports, no references to anything outside
 * its own body (type-only imports are fine).
 */
import type { InteractionArgs } from './interactions';
import type { RawElementRef, RawInteractionEvent, RawInventory, RawNode } from './model/raw';

export interface TrackerArgs extends InteractionArgs {
  /**
   * Selectors whose subtrees are excluded while recording, like
   * `data-uicov-interactive="exclude-all"` (the deprecated
   * `use.uiCoverage.ignoreSelectors`; report-time `ignoreSelectors` are applied in Node).
   */
  ignoreSelectors: string[];
  /** Extra elements to record although they aren't interactive (`RECORDED_CANDIDATES`). */
  extraCandidates: string;
}

export function tracker(args: TrackerArgs): void {
  const w = window as any;
  if (w.__uicovInstalled) return;
  w.__uicovInstalled = true;

  // ---- Interactivity rules ---------------------------------------------
  // Which elements count (README "Which elements count"). Kept apart from
  // identity and event recording so the rules can be moved on their own.

  /** An invalid selector would throw in matches()/closest(); drop it with a warning. */
  const validSelector = (sel: string): boolean => {
    try {
      document.createDocumentFragment().querySelector(sel);
      return true;
    } catch {
      console.warn(`[playwright-ui-coverage] ignoring invalid selector ${JSON.stringify(sel)}`);
      return false;
    }
  };
  const ignoreSelectors = (args.ignoreSelectors || []).filter(validSelector);
  const IGNORE_SELECTOR = ignoreSelectors.join(',');

  /** Interactive ARIA widget roles. Composite containers (menu, tablist, tree…) are not widgets themselves. */
  const WIDGET_ROLES = new Set([
    'button', 'checkbox', 'combobox', 'link', 'listbox', 'menuitem', 'menuitemcheckbox',
    'menuitemradio', 'option', 'radio', 'scrollbar', 'searchbox', 'slider', 'spinbutton',
    'switch', 'tab', 'textbox', 'treeitem',
  ]);
  /**
   * Grouping roles: a widget inside one of these is a separate widget, so it
   * doesn't turn a widget ancestor into a container (a tree item with a
   * nested group of child items still counts).
   */
  const GROUP_ROLES = new Set([
    'group', 'grid', 'listbox', 'menu', 'menubar', 'radiogroup', 'tablist', 'toolbar', 'tree', 'treegrid',
  ]);
  /** Links that hand off to another app; a test can't follow them. */
  const HANDOFF_HREF = /^\s*(tel|mailto|sms):/i;

  /** Elements that may be interactive (isInteractive() decides). Scroll containers are found separately. */
  const CANDIDATES = [
    'a[href]', 'button', 'input', 'select', 'textarea', 'summary', 'audio[controls]',
    'video[controls]', '[contenteditable]', '[role]', '[tabindex]', '[draggable=true]',
    '[data-uicov-interactive]',
  ].join(',');

  const firstRole = (el: Element) => (el.getAttribute('role') || '').trim().toLowerCase().split(/\s+/)[0];

  /** Scroll containers are interactive only when `scroll` interactions are recorded. */
  const scrollEnabled =
    (args.interactions || []).includes('scroll') ||
    (args.allowedInteractions || []).some((r) => r.events.includes('scroll'));

  /** A user-scrollable element whose content overflows (not the document scroller). */
  const isScrollContainer = (el: Element): boolean => {
    if (!scrollEnabled || el === document.body || el === document.documentElement) return false;
    const canX = el.scrollWidth > el.clientWidth + 1;
    const canY = el.scrollHeight > el.clientHeight + 1;
    if (!canX && !canY) return false;
    const style = getComputedStyle(el);
    const scrolls = (v: string) => v === 'auto' || v === 'scroll' || v === 'overlay';
    return (canX && scrolls(style.overflowX)) || (canY && scrolls(style.overflowY));
  };

  /**
   * Why `el` is interactive by its own markup, or '' if it isn't, ignoring
   * `data-uicov-interactive` and nesting. tel:/mailto:/sms: links never are.
   * Then: WHATWG interactive content, an ARIA widget role, tabindex >= 0,
   * draggable="true". Not counted: <label> (its clicks reach the control),
   * <iframe>/<embed>/<object> (their content is another document), <option>
   * in a <select> (the select counts), content inside a contenteditable host.
   */
  const intrinsicKind = (el: Element): '' | 'native' | 'role' | 'tabindex' | 'draggable' => {
    const tag = el.tagName;
    if (tag === 'A' && HANDOFF_HREF.test(el.getAttribute('href') || '')) return '';
    const parent = el.parentElement as HTMLElement | null;
    if (parent?.isContentEditable) return ''; // text being edited, not a control
    if (tag === 'A' && el.hasAttribute('href')) return 'native';
    if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA') return 'native';
    if (tag === 'INPUT' && (el as HTMLInputElement).type !== 'hidden') return 'native';
    if (tag === 'SUMMARY' && parent?.tagName === 'DETAILS') return 'native';
    if ((tag === 'AUDIO' || tag === 'VIDEO') && el.hasAttribute('controls')) return 'native';
    if ((el as HTMLElement).isContentEditable) return 'native'; // the editing host
    if (WIDGET_ROLES.has(firstRole(el))) return 'role';
    const tabindex = el.getAttribute('tabindex');
    if (tabindex !== null && /^\s*\+?\d+\s*$/.test(tabindex)) return 'tabindex';
    if (el.getAttribute('draggable') === 'true') return 'draggable';
    return '';
  };

  const OVERRIDE_SELECTOR = ['[data-uicov-interactive]', '[data-uicov-ignore]', ...ignoreSelectors].join(',');
  type Directive = 'include' | 'exclude' | 'exclude-all' | 'reset' | '';
  /** The directive an element carries itself. `data-uicov-interactive` beats the ignore aliases. */
  const directiveOf = (el: Element): Directive => {
    const v = (el.getAttribute('data-uicov-interactive') || '').trim().toLowerCase();
    if (v === 'include' || v === 'exclude' || v === 'exclude-all' || v === 'reset') return v;
    if (el.hasAttribute('data-uicov-ignore') || (IGNORE_SELECTOR && el.matches(IGNORE_SELECTOR)))
      return 'exclude-all';
    return '';
  };

  /**
   * Markup override from the closest element (self or ancestor) whose
   * directive applies: `include`/`exclude` apply to that element only,
   * `exclude-all` (aliases: `data-uicov-ignore`, `ignoreSelectors`) to its
   * whole subtree, and `reset` stops inheriting (normal rules apply again).
   */
  const markupOverride = (el: Element): 'include' | 'exclude' | '' => {
    let cur: Element | null = el.closest(OVERRIDE_SELECTOR);
    while (cur) {
      const d = directiveOf(cur);
      if (d === 'reset') return '';
      if (d === 'exclude-all') return 'exclude';
      if (cur === el && (d === 'include' || d === 'exclude')) return d;
      cur = cur.parentElement?.closest(OVERRIDE_SELECTOR) ?? null;
    }
    return '';
  };
  const hasDirectives = (el: Element) => !!el.closest(OVERRIDE_SELECTOR);

  /** Interactive by markup and overrides, before the nesting rule. */
  const isWidget = (el: Element): boolean => {
    if (!hasDirectives(el)) return !!intrinsicKind(el);
    const o = markupOverride(el);
    return o === 'include' || (o === '' && !!intrinsicKind(el));
  };
  const isForced = (el: Element) => el.hasAttribute('data-uicov-interactive') && markupOverride(el) === 'include';

  /**
   * The widgets inside `el` that count: not inside a nested group
   * (GROUP_ROLES), and not themselves containers of another one.
   */
  const innerWidgets = (el: Element): Element[] => {
    const found = Array.from(el.querySelectorAll(CANDIDATES)).filter((d) => {
      if (!isWidget(d)) return false;
      for (let p = d.parentElement; p && p !== el; p = p.parentElement) if (GROUP_ROLES.has(firstRole(p))) return false;
      return true;
    });
    return found.filter((d) => isForced(d) || !found.some((o) => o !== d && d.contains(o)));
  };

  /**
   * Whether `el` counts. Nesting rule: a widget that contains other widgets
   * (a clickable card with buttons, a role=combobox wrapper around an
   * <input>) counts once, through the inner widgets. The inner ones are the
   * actual controls (what `getByRole` finds), and counting only the outer one
   * would merge distinct controls into one. Forced (`include`) elements always
   * count. Scroll containers count when `scroll` is recorded, whatever they contain.
   */
  const isInteractive = (el: Element): boolean => {
    if (isWidget(el)) return isForced(el) || innerWidgets(el).length === 0;
    return isScrollContainer(el) && markupOverride(el) !== 'exclude';
  };

  /** Every interactive element in the document, in document order. */
  const interactiveElements = (): Element[] => {
    const found = new Set(Array.from(document.querySelectorAll(CANDIDATES)).filter(isInteractive));
    if (scrollEnabled) {
      for (const el of Array.from(document.querySelectorAll('body *')))
        if (!found.has(el) && isScrollContainer(el) && isInteractive(el)) found.add(el);
    }
    return Array.from(found).sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  };

  /**
   * The element an event on `target` credits, or null. Walks up to the
   * nearest widget; a container widget credits its only inner widget (the
   * same control), or nothing if it has several. A <label> credits its
   * control, except for clicks, which the browser forwards to the control
   * itself. Scroll events credit the scrolled element only.
   */
  const creditedElement = (target: EventTarget | null, type: string): Element | null => {
    let el: Element | null =
      target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    if (!el) return null;
    if (type === 'scroll') return isInteractive(el) ? el : null;
    for (; el; el = el.parentElement) {
      if (el.tagName === 'LABEL' && (el as HTMLLabelElement).control) {
        if (type === 'click') return null;
        const control = (el as HTMLLabelElement).control!;
        return isWidget(control) ? control : null;
      }
      if (isWidget(el)) {
        if (isForced(el)) return el;
        const inner = innerWidgets(el);
        return inner.length === 0 ? el : inner.length === 1 ? inner[0] : null;
      }
      // An excluded control doesn't pass its events on to its ancestors.
      if (hasDirectives(el) && intrinsicKind(el)) return null;
    }
    return null;
  };

  const clean = (s: unknown): string =>
    typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, 60) : '';

  const nameOf = (el: Element): string => {
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || '')
        .join(' ');
      if (clean(text)) return clean(text);
    }
    const input = el as HTMLInputElement;
    const isButtonInput = el.tagName === 'INPUT' && ['submit', 'button', 'reset'].includes(input.type);
    return (
      clean(el.getAttribute('aria-label')) ||
      clean(input.labels?.[0]?.textContent) ||
      clean(el.getAttribute('placeholder')) ||
      clean(el.getAttribute('title')) ||
      clean(el.getAttribute('alt')) ||
      (isButtonInput ? clean(input.value) : '') ||
      clean((el as HTMLElement).innerText) ||
      clean(el.getAttribute('name'))
    );
  };

  // ---- Raw element facts ------------------------------------------------
  // No identity here: Node computes it from these facts (model/resolve.ts).

  const MAX_ATTRS = 40;
  const VALUE_CAP = 256;
  const CLASS_CAP = 1024;

  /** All attributes except `style`; handler code (`on*`) is kept as presence only. Values capped. */
  const attrsOf = (el: Element): Record<string, string> | undefined => {
    let out: Record<string, string> | undefined;
    let n = 0;
    for (const { name, value } of Array.from(el.attributes)) {
      if (name === 'style') continue;
      if (++n > MAX_ATTRS) break;
      (out ??= {})[name] = name.startsWith('on') ? '' : value.slice(0, name === 'class' ? CLASS_CAP : VALUE_CAP);
    }
    return out;
  };

  /**
   * Collects elements into a node table: each element once, parents first,
   * so a chain of ancestors shared by many elements is stored once.
   */
  const nodeTable = () => {
    const nodes: RawNode[] = [];
    const index = new Map<Element, number>();
    const add = (el: Element): number => {
      const known = index.get(el);
      if (known !== undefined) return known;
      const parentEl = el.parentElement;
      const parent = parentEl ? add(parentEl) : undefined;
      const node: RawNode = { tag: el.tagName.toLowerCase() };
      if (parent !== undefined) node.parent = parent;
      if (parentEl) {
        const tag = el.tagName;
        let nth = 0;
        let of = 0;
        for (const c of Array.from(parentEl.children)) {
          if (c.tagName !== tag) continue;
          of++;
          if (c === el) nth = of;
        }
        if (of > 1) {
          node.nth = nth;
          node.of = of;
        }
      }
      const attrs = attrsOf(el);
      if (attrs) node.attrs = attrs;
      index.set(el, nodes.length);
      nodes.push(node);
      return nodes.length - 1;
    };
    return { nodes, add };
  };

  const ref = (el: Element, add: (el: Element) => number): RawElementRef => {
    const out: RawElementRef = { node: add(el) };
    const name = nameOf(el);
    if (name) out.name = name;
    if ((el.tagName === 'A' || el.tagName === 'AREA') && el.hasAttribute('href')) {
      // Only when it can't be derived from the attribute and the page URL (a <base> element).
      const resolved = (el as HTMLAnchorElement).href;
      let derived = '';
      try {
        derived = new URL(el.getAttribute('href') || '', location.href).href;
      } catch {
        /* invalid URL */
      }
      if (resolved && resolved !== derived) out.href = resolved;
    }
    return out;
  };

  // ---- Event recording -------------------------------------------------

  const globalEvents = new Set(args.interactions || []);
  const allowedRules = (args.allowedInteractions || [])
    .filter((r) => validSelector(r.selector))
    .map((r) => ({ selector: r.selector, events: new Set<string>(r.events) }));

  /** `allowedInteractions` (first matching rule) replaces the global list for matching elements. */
  const counts = (el: Element, type: string): boolean => {
    const rule = allowedRules.find((r) => el.matches(r.selector));
    return (rule ? rule.events : globalEvents).has(type);
  };

  /** Scroll gestures: a scroll event counts if the element hadn't scrolled for this long. */
  const SCROLL_GAP_MS = 500;
  const lastScroll = new WeakMap<Element, number>();

  const send = (el: Element, type: string) => {
    const { nodes, add } = nodeTable();
    const event: RawInteractionEvent = { event: type, url: location.href, nodes, element: ref(el, add) };
    // These may navigate away before a delayed snapshot can run, so ship the
    // current inventory with them (synchronously, before navigation).
    const withInventory = type === 'click' || type === 'submit' || type === 'keydown';
    try {
      w.__uicovRecord?.(event, withInventory ? w.__uicovInventory() : undefined);
    } catch {
      /* binding not available (e.g. about:blank) */
    }
  };

  const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date',
    'datetime-local', 'month', 'week', 'time']);
  const isTextEntry = (t: EventTarget | null) =>
    t instanceof HTMLTextAreaElement ||
    (t instanceof HTMLInputElement && TEXT_INPUTS.has(t.type)) ||
    (t instanceof HTMLElement && t.isContentEditable);

  const record = (e: Event) => {
    const type = e.type;
    let target: EventTarget | null = e.target;
    // Keyboard activation only: Enter or Space on the focused element.
    if (type === 'keydown') {
      const k = e as KeyboardEvent;
      if ((k.key !== 'Enter' && k.key !== ' ') || k.repeat || k.isComposing) return;
      // In a text field these keys are typing (counted as `input`), not activation.
      if (isTextEntry(e.target)) return;
    }
    // A submit credits the button that submitted the form (also when submitted with Enter).
    if (type === 'submit') target = (e as SubmitEvent).submitter ?? null;
    const el = creditedElement(target, type);
    if (!el || !counts(el, type)) return;
    if (type === 'scroll') {
      const now = Date.now();
      const last = lastScroll.get(el);
      lastScroll.set(el, now);
      if (last !== undefined && now - last < SCROLL_GAP_MS) return;
    }
    send(el, type);
  };

  const listened = new Set<string>([...globalEvents, ...allowedRules.flatMap((r) => [...r.events])]);
  // Capture phase: sees events the page stops, and non-bubbling ones (focus, blur, scroll).
  for (const type of listened) addEventListener(type, record, true);

  const isVisible = (el: Element) => {
    const anyEl = el as any;
    if (typeof anyEl.checkVisibility === 'function') {
      if (!anyEl.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const EXTRA = args.extraCandidates || '';
  /** Visible interactive elements and visible extra candidates, flagged, in document order. */
  w.__uicovInventory = (): RawInventory => {
    const interactive = interactiveElements();
    const flagged = new Set(interactive);
    const all = EXTRA ? new Set([...interactive, ...Array.from(document.querySelectorAll(EXTRA))]) : flagged;
    const ordered = all === flagged ? interactive : Array.from(all).sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    const { nodes, add } = nodeTable();
    const elements = ordered.filter(isVisible).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        ...ref(el, add),
        ...(flagged.has(el) ? {} : { candidateOnly: true as const }),
        x: Math.round(r.x + window.scrollX),
        y: Math.round(r.y + window.scrollY),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    });
    return { url: location.href, dpr: window.devicePixelRatio || 1, nodes, elements };
  };
}
