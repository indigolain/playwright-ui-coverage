/**
 * In-page tracker. This function is serialized and injected with
 * `page.addInitScript`, so it must be fully self-contained: no imports,
 * no references to anything outside its own body (type-only imports are fine).
 */
import type { IdentityArgs } from './identity';

export interface TrackerArgs extends IdentityArgs {
  ignoreSelectors: string[];
}

export function tracker(args: TrackerArgs): void {
  const w = window as any;
  if (w.__uicovInstalled) return;
  w.__uicovInstalled = true;

  const INTERACTIVE = [
    'button',
    'a[href]',
    'input:not([type=hidden])',
    'select',
    'textarea',
    'summary',
    '[contenteditable=""]',
    '[contenteditable=true]',
    '[role=button]',
    '[role=link]',
    '[role=checkbox]',
    '[role=radio]',
    '[role=switch]',
    '[role=tab]',
    '[role=menuitem]',
    '[role=option]',
    '[role=combobox]',
    '[role=textbox]',
    '[role=slider]',
  ].join(',');
  const IGNORE = ['[data-uicov-ignore]', ...(args.ignoreSelectors || [])].join(',');

  const clean = (s: unknown): string =>
    typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, 60) : '';

  const IMPLICIT_ROLES: Record<string, string> = {
    a: 'link',
    button: 'button',
    select: 'combobox',
    textarea: 'textbox',
    summary: 'button',
  };
  const INPUT_ROLES: Record<string, string> = {
    checkbox: 'checkbox',
    radio: 'radio',
    range: 'slider',
    submit: 'button',
    button: 'button',
    reset: 'button',
    image: 'button',
    search: 'searchbox',
  };

  const roleOf = (el: Element): string => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') return INPUT_ROLES[(el as HTMLInputElement).type] || 'textbox';
    if (el.hasAttribute('contenteditable')) return 'textbox';
    return IMPLICIT_ROLES[tag] || tag;
  };

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

  // ---- Identity -------------------------------------------------------
  // Order: data-uicov-id → identityAttributes (significant + built-in test
  // ids) → id → name → structural path. Text is only used for the label.
  const filters = (args.attributeFilters || []).map((f) => ({
    attribute: new RegExp(f.attribute, 'i'),
    value: f.value === undefined ? undefined : new RegExp(f.value),
    include: f.include,
  }));
  const identityAttributes = args.identityAttributes || [];

  /** The first matching filter decides; no match means the value is usable. */
  const usable = (attr: string, value: string): boolean => {
    if (!value.trim()) return false;
    for (const f of filters) {
      if (f.attribute.test(attr) && (!f.value || f.value.test(value))) return f.include;
    }
    return true;
  };

  const quote = (v: string) => JSON.stringify(v);

  /** Attribute-based identity of `el`, or '' if it has none. */
  const identityOf = (el: Element): string => {
    const explicit = el.getAttribute('data-uicov-id');
    if (explicit && explicit.trim()) return explicit.trim();
    for (const attr of identityAttributes) {
      const v = el.getAttribute(attr);
      if (v !== null && usable(attr, v)) return `[${attr}=${quote(v)}]`;
    }
    const id = el.getAttribute('id');
    if (id && usable('id', id)) return /^[A-Za-z_][\w-]*$/.test(id) ? `#${id}` : `[id=${quote(id)}]`;
    const name = el.getAttribute('name');
    if (name && usable('name', name)) {
      let key = `[name=${quote(name)}]`;
      // Radio buttons / checkboxes in a group share a name; tell them apart by value.
      const type = (el as HTMLInputElement).type;
      const value = el.getAttribute('value');
      if (el.tagName === 'INPUT' && (type === 'radio' || type === 'checkbox') && value)
        key += `[value=${quote(value)}]`;
      return key;
    }
    return '';
  };

  // Table rows are repeated data: the controls in each row are instances of
  // one element (e.g. a "Delete" button per row), so rows get no index.
  const isRow = (el: Element) => el.tagName === 'TR' || el.getAttribute('role') === 'row';

  /**
   * Structural fallback: `tag:nth-of-type(n)` steps (index only when there are
   * same-tag siblings) up to the nearest ancestor that has an identity, or up
   * to <body>. Reads as a CSS selector, e.g. `#rows > tr > td:nth-of-type(2) > button`.
   */
  const structuralKey = (el: Element): string => {
    const steps: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      if (cur !== el) {
        const anchor = identityOf(cur);
        if (anchor) {
          // A data-uicov-id value isn't a selector; show it as one so the path stays readable.
          steps.unshift(cur.hasAttribute('data-uicov-id') ? `[data-uicov-id=${quote(anchor)}]` : anchor);
          break;
        }
      }
      let step = cur.tagName.toLowerCase();
      const parent: Element | null = cur.parentElement;
      if (parent && !isRow(cur)) {
        const tag = cur.tagName;
        const same = Array.from(parent.children).filter((c) => c.tagName === tag);
        if (same.length > 1) step += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      steps.unshift(step);
      cur = parent;
    }
    return steps.join(' > ');
  };

  const RAW_ATTRS = ['id', 'name', 'role', 'type', 'aria-label', 'href'];
  /** Raw identifying attributes, so identity can be recomputed later with other rules. */
  const rawAttrs = (el: Element): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const { name, value } of Array.from(el.attributes)) {
      if (name.startsWith('data-') || RAW_ATTRS.includes(name) || identityAttributes.includes(name))
        out[name] = value.slice(0, 200);
    }
    const type = (el as HTMLInputElement).type;
    if (el.tagName === 'INPUT' && (type === 'radio' || type === 'checkbox') && el.hasAttribute('value'))
      out.value = (el.getAttribute('value') || '').slice(0, 200);
    return out;
  };

  const describe = (el: Element) => {
    const role = roleOf(el);
    const name = nameOf(el);
    const label = name ? `${role} "${name}"` : role;
    const key = identityOf(el) || structuralKey(el);
    return { key, label, attrs: rawAttrs(el) };
  };

  const isIgnored = (el: Element) => !!el.closest(IGNORE);

  const record = (e: Event) => {
    const target = e.target as Element | null;
    const el = target?.closest?.(INTERACTIVE);
    if (!el || isIgnored(el)) return;
    const { key, label, attrs } = describe(el);
    // Clicks/submits may navigate away before a delayed snapshot can run, so
    // ship the current inventory with them (synchronously, before navigation).
    const withInventory = e.type === 'click' || e.type === 'submit';
    try {
      w.__uicovRecord?.(
        { key, label, attrs, event: e.type, url: location.href },
        withInventory ? w.__uicovInventory() : undefined,
      );
    } catch {
      /* binding not available (e.g. about:blank) */
    }
  };
  for (const type of ['click', 'input', 'change', 'submit']) {
    addEventListener(type, record, true);
  }

  const isVisible = (el: Element) => {
    const anyEl = el as any;
    if (typeof anyEl.checkVisibility === 'function') {
      if (!anyEl.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  w.__uicovInventory = () => ({
    url: location.href,
    dpr: window.devicePixelRatio || 1,
    elements: Array.from(document.querySelectorAll(INTERACTIVE))
      .filter((el) => !isIgnored(el) && isVisible(el))
      .map((el) => {
        const r = el.getBoundingClientRect();
        const { key, label, attrs } = describe(el);
        return {
          key,
          label,
          attrs,
          tag: el.tagName.toLowerCase(),
          x: Math.round(r.x + window.scrollX),
          y: Math.round(r.y + window.scrollY),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      }),
  });
}
