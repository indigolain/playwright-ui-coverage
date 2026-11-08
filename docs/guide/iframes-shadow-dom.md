# Iframes and shadow DOM

This page explains how elements inside iframes and shadow roots are recorded, keyed and filtered.

Elements inside **iframes** (same-origin and cross-origin) and **open shadow roots** count like any other element of the page, under the page's URL.

## Keys

Keys are prefixed by the key of the frame element or shadow host and ` >> `, as many times as they are nested:

```
iframe[data-testid="payments"] >> [data-testid="card"]
promo-banner >> div > button:nth-of-type(2)
[data-testid="payments"] >> #pay > brand-picker >> div > button
```

Each part is computed in its own document or shadow tree (a positional key stops at the shadow root). A `data-uicov-id` value is still used as-is, without a prefix. Elements in a frame also list the frame elements' keys in `coverage.json` (`frames`). See [Element identity](./element-identity.md).

## Recording

- Each frame runs its own copy of the tracker. The recorder places the frame's elements under the frame element (`page.frames()`), with boxes mapped into the page's coordinates (frame element's content box, scroll positions), so overlays line up on the page screenshot.
- Elements scrolled out of their frame still count but get no box.
- In shadow roots, events are credited to the element they happened on (`composedPath()`), including events that don't leave the shadow root, like `change`.
- Links inside iframes stay interactive elements (they navigate the frame), see [Links](./links.md#links-that-stay-elements).

## Filtering

- **Markup overrides** apply across shadow boundaries: `data-uicov-ignore` on a host excludes its shadow content.
- Across frames they apply at report time: an ignored `<iframe>` (by `data-uicov-ignore` or `ignoreSelectors`) excludes everything inside it.
- [`elementFilters`](./rules.md#elementfilters) match the element itself, so to exclude a frame's content use a `documentScope`:

```ts
elementFilters: [
  { selector: '*', documentScope: 'iframe#ads', include: false },
],
```

See [documentScope](./rules.md#documentscope) for host chains (`iframe#app >> date-picker`).

## Closed shadow roots

Closed shadow roots can't be read from the page, so their content isn't recorded. The host counts if it is interactive itself (e.g. `role="button"`, `tabindex="0"`), and events inside are credited to it.

## Suggested locators

Suggested locators use `page.frameLocator('<frame key>')` for elements in frames (once per nested frame). Playwright's locators already pierce open shadow roots, so shadow content needs nothing special. See [Suggested locators](./locators-and-accessibility.md#suggested-locators).

## Limitations

- Cross-origin iframes can run in their own process, and Chromium paints those in full-page screenshots only where they are inside the viewport. Their elements outside the viewport still count, but get no box in that screenshot.
- The deprecated recording-time `use.uiCoverage.ignoreSelectors` doesn't reach into frames from the parent page (`iframe.ads button`); use the report-time `elementFilters` with `documentScope`, which do.
