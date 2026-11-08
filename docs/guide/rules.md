# Report-time rules

This page covers the rules that decide, when the report is built, which elements count and how they are identified: `elementFilters`, named `elements`, `significantAttributes`, `attributeFilters`, `documentScope` for frames and shadow roots, and the deprecated `ignoreSelectors`.

Because they are applied to the recorded data, you can change them and [rebuild the report](./how-it-works.md#rebuilding-the-report) (`npx playwright-ui-coverage report`) without running the tests again.

## Overview

```ts
// ui-coverage.config.ts
import { defineUiCoverageConfig } from 'playwright-ui-coverage/config';

export default defineUiCoverageConfig({
  elementFilters: [                                        // default: []
    { selector: '.cookie-banner *', include: false },
    { selector: 'footer a.important', include: true },     // protects it from the next rule
    { selector: 'footer *', include: false },
    { selector: 'button', documentScope: 'iframe#ads', include: false },
  ],
  elements: [                                              // default: []
    { selector: '#main-nav [href="/"]', name: 'Logo home link' },
  ],
  significantAttributes: ['data-component'],              // default: []
  attributeFilters: [                                      // default: []
    { attribute: 'id', value: 'tmp-.*' },                  // ignore id="tmp-…"
    { attribute: 'id', value: 'mui-legacy', include: true, comment: 'stable, despite the built-in rule' },
  ],
  elementGroups: [{ selector: '.product-card', name: 'product card' }], // default: []
  autoGroup: { rows: true, repeated: true, labels: true, forms: true }, // default (or true / false)
});
```

The type is exported as `UiCoverageRules`. `elementGroups` and `autoGroup` are explained in [Element grouping](./element-grouping.md), `links` in [Links and untested views](./links.md), and `views` / `viewFilters` in [Views](./views.md).

## elementFilters

`{ selector, include, documentScope?, comment? }` rules deciding which interactive elements count. The **first** rule whose selector matches an element decides: `include: false` excludes it, `include: true` keeps it, whatever later rules say. Elements no rule matches count. An entry's `documentScope` limits it to frames or shadow hosts, see [documentScope](#documentscope).

The selector matches **the interactive element itself**, not a container: `footer *` matches everything inside a `<footer>`, while `footer` matches only the footer element (which usually doesn't count anyway, so the rule does nothing). Like any selector it stays within one document or shadow tree: for a web component's shadow content inside the footer, add `{ selector: '*', documentScope: 'footer my-widget', include: false }`.

Markup directives (`data-uicov-ignore`, `data-uicov-interactive`) are applied while recording, so an `include: true` rule can't bring back an element the markup excludes, nor make a non-interactive element count. Selectors are evaluated on the recorded structure, see [Report-time selectors](#report-time-selectors).

One difference from excluding in the markup: the [nesting rule](./which-elements-count.md#nested-widgets-count-once-as-the-inner-ones) is decided while recording, so excluding all inner widgets of a container widget doesn't make the container count.

## Named elements

`elements` pins the identity of single elements, and gives them a readable name in the report:

```ts
elements: [
  { selector: '#main-nav [href="/"]', name: 'Logo home link' },
  { selector: 'button.icon-star', name: 'Star (icon only)', comment: 'no accessible name yet' },
  { selector: '[data-testid="card"]', documentScope: 'iframe#payments' }, // no name: the selector is the key
],
```

- The element's key (and label) becomes `name`, used as-is like a `data-uicov-id` value: it no longer changes when the markup around the element moves. Without `name`, the key is the selector (prefixed by `documentScope >> `) and the label stays `role "accessible name"`.
- A rule applies to an element when its selector matches it and **no other counted element in the same snapshot**, in every snapshot of the test that shows it (an element only seen in an interaction, never in a snapshot, just has to match). A selector that matches several elements (a button on every row) doesn't name any of them. Elements excluded by `elementFilters` don't count as matches.
- When several rules apply to an element, the **last** one wins. Names must be unique (a duplicate is a config error).
- Renaming changes the key, so the [baseline](../ci/baseline.md) sees the old key as resolved and the new one as new. Suggested locators keep using the element's own key, accessibility hints its accessible name.

## significantAttributes

Attributes that identify an element, checked after `data-uicov-id` and before the built-in test-id attributes, in the order given. See the key rules in [Element identity](./element-identity.md).

```ts
significantAttributes: ['data-component'],   // key: [data-component="avatar"]
```

An attribute that doesn't start with `data-` is only recorded if it's listed here.

## attributeFilters

`{ attribute, value?, include?, comment? }` rules deciding whether an attribute value may be used as a key. `attribute` and `value` are regular expressions, anchored automatically (`'id'` means `^(?:id)$`). Attribute names match case-insensitively, values case-sensitively. Without `value`, the rule matches any value. The first matching rule wins: `include: false` (default) skips the value, `include: true` keeps it.

Your rules run before the built-in ones, which skip:

- React `useId` values (`:r1:`, `:R2kq:`, `«r1»`), UUIDs and hex strings of 16+ characters, in any attribute;
- in `id` and `name`: framework counters (`ember123`, `mui-12345`, `radix-…`, `headlessui-…`, `react-aria-…`, `downshift-…`, `react-select-…`, `mat-…-0`, `cdk-…-3`, `ui-id-4`, `ext-gen12`, `gwt-uid-3`, `yui_…`, `j_id…`), purely numeric values and values with 3+ consecutive digits.

The built-in lists are exported as `BUILTIN_IDENTITY_ATTRIBUTES` and `BUILTIN_ATTRIBUTE_FILTERS`.

## Report-time selectors

Selector rules run in Node on the recorded DOM structure (each element with its attributes, its position among same-tag siblings and its ancestors), not in the browser. Supported:

- type (`button`), `*`, `#id`, `.class`, attribute selectors (`[a]`, `[a=v]`, `~=`, `|=`, `^=`, `$=`, `*=`, with the ` i` / ` s` flags);
- descendant (` `) and child (`>`) combinators, selector lists (`,`);
- `:not()`, `:is()`, `:where()`, `:nth-of-type()`, `:nth-last-of-type()`, `:first-of-type`, `:last-of-type`, `:only-of-type`, `:root`.

Not supported, because the data needed isn't recorded: sibling combinators (`+`, `~`), `:has()`, `:nth-child()` and friends, state pseudo-classes (`:checked`, `:hover`, `:disabled`, …). An unsupported selector fails the run (or the CLI) with a message saying which part isn't supported. Attribute values are recorded up to 256 characters (`class` up to 1024), and `style` isn't recorded.

Like CSS in the browser, a selector matches within one document or shadow tree: combinators don't cross into an iframe or a shadow root (`main button` doesn't match a button in a shadow root under `<main>`), and `:root` matches each document's `<html>`. A selector without a host chain matches in every document and shadow tree.

## documentScope

To target elements inside a frame or shadow host, give a host chain (in `elementFilters`, `elements` and `ignoreSelectors`; `elementGroups` takes a `documentScope` too): selectors for the frame elements or shadow hosts, outermost first, separated by `>>`. Either as `documentScope`, or inline before the selector:

```ts
elementFilters: [
  { selector: 'button', documentScope: 'iframe[data-testid="payments"]', include: false },
  { selector: 'button.today', documentScope: 'iframe#app >> date-picker', include: false },
  { selector: 'iframe#app >> date-picker >> button.today', include: false }, // the same, inline
],
```

Each host selector is matched in the host's own document or shadow tree. The hosts must appear in that order among the element's frames and shadow hosts, but not necessarily directly nested: `documentScope: 'my-widget'` covers every tree inside any `<my-widget>`, in the page or in a frame.

A key from the report (`iframe[data-testid="pay"] >> [data-testid="card"]`) works as a selector, except a positional key's first part, which is relative to `<body>`.

To exclude everything inside a frame: `elementFilters` match the element itself, so use `{ selector: '*', documentScope: 'iframe#ads', include: false }`. (With the deprecated `ignoreSelectors`, ignoring the host itself, `['iframe#ads']`, already excludes everything inside it.)

## Deprecated: ignoreSelectors

Use `elementFilters` instead. `ignoreSelectors` takes selectors (strings or `{ selector, documentScope }`) that exclude the elements they match **and everything inside them**, also inside a frame or shadow host they match. Same rules as `data-uicov-interactive="exclude-all"` (a `reset` inside stops it, an element's own `include` wins).

It keeps working exactly as before and is checked after `elementFilters`, so an `include: true` filter protects from it. `ignoreSelectors: ['.cookie-banner']` is `elementFilters: [{ selector: '.cookie-banner, .cookie-banner *', include: false }]`, except that the alias also reaches into frames and shadow roots inside `.cookie-banner` and honors those markup directives.

## Deprecated: rules in use.uiCoverage

`ignoreSelectors`, `significantAttributes` and `attributeFilters` used to be recording options. In `use.uiCoverage` (in `playwright.config.ts`) they still work, but are deprecated (and not accepted in `recording`):

- `significantAttributes` and `attributeFilters` are recorded with the data and applied at report time. If the config (file, reporter options or profile) sets the same rule (even to `[]`), the config's value wins.
- `ignoreSelectors` is applied while recording (as before, with any CSS the browser supports), so it can't be undone at report time. It also doesn't reach into frames from the parent page (`iframe.ads button`); the report-time `elementFilters` with `documentScope` do.

Move them to the config file to change them without re-running tests.
