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
 * Open shadow roots are part of the inventory and of event crediting (the
 * composed tree); closed ones are opaque, so their host stands for them.
 * Each frame runs its own copy: the recorder stitches child frames' data
 * into the page (`recorder.ts`).
 *
 * This function is serialized and injected with `page.addInitScript`, so it
 * must be fully self-contained: no imports, no references to anything outside
 * its own body (type-only imports are fine).
 */
import type { InteractionArgs } from './interactions';
import type { RawElementRef, RawFrameHost, RawInteractionEvent, RawInventory, RawNode, RawViewport } from './model/raw';

export interface TrackerArgs extends InteractionArgs {
  /**
   * Selectors whose subtrees are excluded while recording, like
   * `data-uicov-interactive="exclude-all"` (the deprecated
   * `use.uiCoverage.ignoreSelectors`; report-time `ignoreSelectors` are applied in Node).
   */
  ignoreSelectors: string[];
  /** Extra elements to record although they aren't interactive (`RECORDED_CANDIDATES`). */
  extraCandidates: string;
  /**
   * Send an inventory (`__uicovRecord(null, inventory)`) right after an interaction's handlers
   * ran, if they changed the DOM, so short-lived states can be screenshotted
   * (`captureTransientStates`).
   */
  settleInventory?: boolean;
}

export function tracker(args: TrackerArgs): void {
  const w = window as any;
  if (w.__uicovInstalled) return;
  w.__uicovInstalled = true;

  // ---- Composed tree -----------------------------------------------------
  // Open shadow roots are walked like part of the document: an element at the
  // top of one has the shadow host as its (composed) parent.

  /** Open shadow roots seen so far (attached since the tracker started, or found by `walk`). */
  const shadowRoots = new Set<ShadowRoot>();
  /** Called for each newly seen root (adds the event listeners, see below). */
  let onShadowRoot = (_root: ShadowRoot) => {};
  const addShadowRoot = (root: ShadowRoot | null | undefined) => {
    if (!root || shadowRoots.has(root)) return;
    shadowRoots.add(root);
    onShadowRoot(root);
  };
  // Hook attachShadow so roots created between inventories get listeners right
  // away (non-composed events like `change` and `submit` don't leave a shadow
  // root). Declarative shadow roots don't go through it; `walk` finds those.
  const attachShadow = Element.prototype.attachShadow;
  if (attachShadow) {
    Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) {
      const root = attachShadow.call(this, init);
      if (init && init.mode === 'open') addShadowRoot(root);
      return root;
    };
  }

  /** Parent in the composed tree: the parent element, or the host for a shadow root's top-level element. */
  const composedParent = (el: Element): Element | null =>
    el.parentElement ?? (el.parentNode instanceof ShadowRoot ? el.parentNode.host : null);
  /** `a` contains `b` (b !== a) in the composed tree. */
  const composedContains = (a: Element, b: Element): boolean => {
    for (let p = composedParent(b); p; p = composedParent(p)) if (p === a) return true;
    return false;
  };
  /** `Element.closest` that continues at the shadow host. */
  const composedClosest = (el: Element | null, sel: string): Element | null => {
    for (let cur = el; cur; ) {
      const found = cur.closest(sel);
      if (found) return found;
      const root = cur.getRootNode();
      cur = root instanceof ShadowRoot ? root.host : null;
    }
    return null;
  };
  /** Connected open shadow roots (forgets disconnected ones). */
  const liveRoots = (): ShadowRoot[] => {
    const out: ShadowRoot[] = [];
    for (const r of shadowRoots) {
      if (r.host.isConnected) out.push(r);
      else shadowRoots.delete(r);
    }
    return out;
  };
  /**
   * Every element in the composed tree, in composed order (a host, then its
   * shadow tree, then its light children). Registers open roots on the way.
   */
  const walk = (): Element[] => {
    const out: Element[] = [];
    const visit = (root: Document | ShadowRoot) => {
      for (const el of Array.from(root.querySelectorAll('*'))) {
        out.push(el);
        if (el.shadowRoot) {
          addShadowRoot(el.shadowRoot);
          visit(el.shadowRoot);
        }
      }
    };
    visit(document);
    return out;
  };
  /** `querySelectorAll` over `scope` (the document or an element) and the open shadow trees inside it. */
  const queryComposed = (scope: Document | Element, sel: string): Element[] => {
    const out = Array.from(scope.querySelectorAll(sel));
    if (shadowRoots.size === 0) return out;
    for (const r of liveRoots())
      if (scope === document || r.host === scope || composedContains(scope as Element, r.host))
        out.push(...Array.from(r.querySelectorAll(sel)));
    return out;
  };

  // ---- Interactivity rules ---------------------------------------------
  // Which elements count (docs "Which elements count"). Kept apart from
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
    let cur: Element | null = composedClosest(el, OVERRIDE_SELECTOR);
    while (cur) {
      const d = directiveOf(cur);
      if (d === 'reset') return '';
      if (d === 'exclude-all') return 'exclude';
      if (cur === el && (d === 'include' || d === 'exclude')) return d;
      cur = composedClosest(composedParent(cur), OVERRIDE_SELECTOR);
    }
    return '';
  };
  /** Directives apply across shadow boundaries: `exclude-all` on a host covers its shadow tree. */
  const hasDirectives = (el: Element) => !!composedClosest(el, OVERRIDE_SELECTOR);

  /** Interactive by markup and overrides, before the nesting rule. */
  const isWidget = (el: Element): boolean => {
    if (!hasDirectives(el)) return !!intrinsicKind(el);
    const o = markupOverride(el);
    return o === 'include' || (o === '' && !!intrinsicKind(el));
  };
  const isForced = (el: Element) => el.hasAttribute('data-uicov-interactive') && markupOverride(el) === 'include';

  /**
   * The widgets inside `el` (including its open shadow trees) that count: not
   * inside a nested group (GROUP_ROLES), and not themselves containers of another one.
   */
  const innerWidgets = (el: Element): Element[] => {
    const found = queryComposed(el, CANDIDATES).filter((d) => {
      if (!isWidget(d)) return false;
      for (let p = composedParent(d); p && p !== el; p = composedParent(p)) if (GROUP_ROLES.has(firstRole(p))) return false;
      return true;
    });
    return found.filter((d) => isForced(d) || !found.some((o) => o !== d && composedContains(d, o)));
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

  /** The interactive elements among `all` (every element, in composed order: `walk()`), in that order. */
  const interactiveElements = (all: Element[]): Element[] => {
    const found = new Set(queryComposed(document, CANDIDATES).filter(isInteractive));
    if (scrollEnabled) {
      for (const el of all) if (!found.has(el) && isScrollContainer(el) && isInteractive(el)) found.add(el);
    }
    return all.filter((el) => found.has(el));
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
    for (; el; el = composedParent(el)) {
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

  /** Accessible name and where it came from (`nameFrom`, used for locators and a11y hints). Display only. */
  const nameOf = (el: Element): { name: string; nameFrom: string } => {
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      // ids are per tree: look them up in the element's document or shadow root.
      const root = el.getRootNode() as Document | ShadowRoot;
      const byId = (id: string) => (root.getElementById ? root.getElementById(id) : document.getElementById(id));
      const text = labelledBy
        .split(/\s+/)
        .map((id) => byId(id)?.textContent || '')
        .join(' ');
      if (clean(text)) return { name: clean(text), nameFrom: 'aria-labelledby' };
    }
    const input = el as HTMLInputElement;
    const isButtonInput = el.tagName === 'INPUT' && ['submit', 'button', 'reset'].includes(input.type);
    const sources: [string, () => unknown][] = [
      ['aria-label', () => el.getAttribute('aria-label')],
      ['label', () => input.labels?.[0]?.textContent],
      ['placeholder', () => el.getAttribute('placeholder')],
      ['title', () => el.getAttribute('title')],
      ['alt', () => el.getAttribute('alt')],
      ['value', () => (isButtonInput ? input.value : '')],
      ['text', () => (el as HTMLElement).innerText],
      ['name', () => el.getAttribute('name')], // not an accessible name; display only
    ];
    for (const [from, get] of sources) {
      const v = clean(get());
      if (v) return { name: v, nameFrom: from };
    }
    return { name: '', nameFrom: '' };
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
    const index = new Map<Node, number>();
    /** A shadow root is a `#shadow-root` pseudo-node under its host. */
    const addRoot = (root: ShadowRoot): number => {
      const known = index.get(root);
      if (known !== undefined) return known;
      const node: RawNode = { tag: '#shadow-root', parent: add(root.host) };
      index.set(root, nodes.length);
      nodes.push(node);
      return nodes.length - 1;
    };
    const add = (el: Element): number => {
      const known = index.get(el);
      if (known !== undefined) return known;
      const parentEl: Element | ShadowRoot | null =
        el.parentElement ?? (el.parentNode instanceof ShadowRoot ? el.parentNode : null);
      const parent = !parentEl ? undefined : parentEl instanceof ShadowRoot ? addRoot(parentEl) : add(parentEl);
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
    const { name, nameFrom } = nameOf(el);
    if (name) {
      out.name = name;
      out.nameFrom = nameFrom;
    }
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
    if (type !== 'scroll') settleAfter();
  };

  // ---- Short-lived states ----------------------------------------------
  // The inventory sent with a click is taken before the page's handlers run
  // (capture phase), so it can't show what the click opens. When the handlers
  // change the DOM, send another inventory once they're done; the recorder
  // screenshots it right away if it shows something new, before the test can
  // close it again (a modal opened, filled and saved within a few ms).

  /** Set by DOM mutations; cleared when an interaction starts. */
  let mutated = false;
  let settlePending = false;
  /**
   * Playwright's own screenshot preparation touches the DOM: it adds and
   * removes a <style> element and sets `caret-color` on text fields. Those
   * aren't the page reacting to an interaction.
   */
  const stripCaret = (v: string | null) => (v || '').replace(/caret-color\s*:[^;]*;?/g, '').trim();
  const isOwnChange = (r: MutationRecord) =>
    r.type === 'childList'
      ? [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)].every((n) => n.nodeName === 'STYLE')
      : r.attributeName === 'style' && stripCaret(r.oldValue) === stripCaret((r.target as Element).getAttribute('style'));
  if (args.settleInventory && typeof MutationObserver === 'function') {
    new MutationObserver((records) => {
      if (!mutated && !records.every(isOwnChange)) mutated = true;
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeOldValue: true });
  }
  const sendSettled = () => {
    try {
      w.__uicovRecord?.(null, w.__uicovInventory());
    } catch {
      /* binding not available */
    }
  };
  /**
   * After the current event's handlers (a task later), and once more shortly
   * after for frameworks that render asynchronously, if nothing changed yet.
   */
  const settleAfter = () => {
    if (!args.settleInventory || settlePending) return;
    settlePending = true;
    mutated = false;
    setTimeout(() => {
      if (mutated) {
        settlePending = false;
        sendSettled();
        return;
      }
      setTimeout(() => {
        settlePending = false;
        if (mutated) sendSettled();
      }, 50);
    }, 0);
  };

  const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date',
    'datetime-local', 'month', 'week', 'time']);
  const isTextEntry = (t: EventTarget | null) =>
    t instanceof HTMLTextAreaElement ||
    (t instanceof HTMLInputElement && TEXT_INPUTS.has(t.type)) ||
    (t instanceof HTMLElement && t.isContentEditable);

  const record = (e: Event) => {
    const type = e.type;
    // The innermost target: for events from open shadow trees, e.target is the host.
    let target: EventTarget | null = (e.composedPath && e.composedPath()[0]) || e.target;
    // Keyboard activation only: Enter or Space on the focused element.
    if (type === 'keydown') {
      const k = e as KeyboardEvent;
      if ((k.key !== 'Enter' && k.key !== ' ') || k.repeat || k.isComposing) return;
      // In a text field these keys are typing (counted as `input`), not activation.
      if (isTextEntry(target)) return;
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
  // Events that aren't composed (change, submit, scroll…) stay inside their
  // shadow root, so each open root gets listeners too; composed events reach `window`.
  const recordInRoot = (e: Event) => {
    if (!e.composed) record(e);
  };
  onShadowRoot = (root) => {
    for (const type of listened) root.addEventListener(type, recordInRoot, true);
  };
  shadowRoots.forEach(onShadowRoot);

  const isVisible = (el: Element) => {
    const anyEl = el as any;
    if (typeof anyEl.checkVisibility === 'function') {
      if (!anyEl.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  // ---- Positioning and viewport ------------------------------------------

  /**
   * Effective positioning of elements (`RawElement.pos`), memoized for one
   * inventory since ancestors are shared: `fixed` if the element or any
   * ancestor is fixed (modal dialogs and popovers in the top layer are),
   * else `sticky` if it or an ancestor is sticky, else ''.
   */
  const positioning = () => {
    const memo = new Map<Element, '' | 'fixed' | 'sticky'>();
    const of = (el: Element | null): '' | 'fixed' | 'sticky' => {
      if (!el || el === document.documentElement) return '';
      const known = memo.get(el);
      if (known !== undefined) return known;
      const own = getComputedStyle(el).position;
      const inherited = own === 'fixed' ? 'fixed' : of(el.parentElement);
      const v = inherited === 'fixed' ? 'fixed' : own === 'sticky' ? 'sticky' : inherited;
      memo.set(el, v);
      return v;
    };
    return of;
  };

  /** Scroll offset and layout viewport size (document CSS px). */
  const viewportOf = (): RawViewport => {
    const d = document.documentElement;
    return {
      x: Math.round(window.scrollX),
      y: Math.round(window.scrollY),
      w: (d && d.clientWidth) || window.innerWidth,
      h: (d && d.clientHeight) || window.innerHeight,
      ...(window.visualViewport && window.visualViewport.scale !== 1 ? { zoom: window.visualViewport.scale } : {}),
    };
  };

  const EXTRA = args.extraCandidates || '';
  /** Visible interactive elements and visible extra candidates, flagged, in document order. */
  w.__uicovInventory = (): RawInventory => {
    const all = walk();
    const interactive = interactiveElements(all);
    const flagged = new Set(interactive);
    let ordered = interactive;
    if (EXTRA) {
      const extra = new Set(queryComposed(document, EXTRA));
      ordered = all.filter((el) => flagged.has(el) || extra.has(el));
    }
    const { nodes, add } = nodeTable();
    const posOf = positioning();
    const elements = ordered.filter(isVisible).map((el) => {
      const r = el.getBoundingClientRect();
      const pos = posOf(el);
      return {
        ...ref(el, add),
        ...(flagged.has(el) ? {} : { candidateOnly: true as const }),
        x: Math.round(r.x + window.scrollX),
        y: Math.round(r.y + window.scrollY),
        w: Math.round(r.width),
        h: Math.round(r.height),
        ...(pos ? { pos } : {}),
      };
    });
    return {
      url: location.href,
      dpr: window.devicePixelRatio || 1,
      viewport: viewportOf(),
      nodes,
      elements,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  };

  /** Node chain and content box of a frame element in this document (the recorder maps child frames with it). */
  w.__uicovFrameHost = (el: Element): RawFrameHost => {
    const { nodes, add } = nodeTable();
    const node = add(el);
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const px = (v: string) => parseFloat(v) || 0;
    const [pl, pt, pr, pb] = [s.paddingLeft, s.paddingTop, s.paddingRight, s.paddingBottom].map(px);
    return {
      nodes,
      node,
      x: r.left + el.clientLeft + pl + window.scrollX,
      y: r.top + el.clientTop + pt + window.scrollY,
      w: Math.max(0, el.clientWidth - pl - pr),
      h: Math.max(0, el.clientHeight - pt - pb),
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    };
  };
}
