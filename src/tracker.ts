/**
 * In-page tracker. This function is serialized and injected with
 * `page.addInitScript`, so it must be fully self-contained: no imports,
 * no references to anything outside its own body.
 */
export interface TrackerArgs {
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

  // Auto-generated ids (React useId ":r1:", "ember123", "el-48213") are unstable.
  const isStableId = (id: string) => !!id && !/[:]|\d{3,}/.test(id);

  const describe = (el: Element) => {
    const role = roleOf(el);
    const name = nameOf(el);
    const label = name ? `${role} "${name}"` : role;
    const testId = el.getAttribute('data-testid');
    let key: string;
    if (testId) key = `[data-testid="${testId}"]`;
    else if (isStableId(el.id)) key = `#${el.id}`;
    else key = label;
    return { key, label };
  };

  const isIgnored = (el: Element) => !!el.closest(IGNORE);

  const record = (e: Event) => {
    const target = e.target as Element | null;
    const el = target?.closest?.(INTERACTIVE);
    if (!el || isIgnored(el)) return;
    const { key, label } = describe(el);
    // Clicks/submits may navigate away before a delayed snapshot can run, so
    // ship the current inventory with them (synchronously, before navigation).
    const withInventory = e.type === 'click' || e.type === 'submit';
    try {
      w.__uicovRecord?.(
        { key, label, event: e.type, url: location.href },
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
        const { key, label } = describe(el);
        return {
          key,
          label,
          tag: el.tagName.toLowerCase(),
          x: Math.round(r.x + window.scrollX),
          y: Math.round(r.y + window.scrollY),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      }),
  });
}
