# Element identity

This page explains how an element is recognized as "the same element" across tests and runs, and how to make that identity stable. Identity matters because an element is tested if *any* test interacted with it, and because [baselines](../ci/baseline.md) and [comparisons](../ci/compare.md) match elements by key.

## Keys: attributes and position, never text

Elements are matched by **attributes and position, never by visible text**, so copy changes, translations and dynamic text (counters, user names, timestamps) don't turn one element into a new one. The first rule that applies gives the element's key:

| # | Source | Key in the report |
|---|---|---|
| 0 | an [`elements`](./rules.md#named-elements) rule in the config | `Logo home link` (its `name` as-is) |
| 1 | `data-uicov-id` (explicit override, never filtered) | `checkout-submit` (the value as-is) |
| 2 | `significantAttributes` you configure, in order | `[data-component="avatar"]` |
| 3 | `data-testid`, `data-test`, `data-test-id`, `data-cy`, `data-qa`, `row-id` | `[data-testid="save"]` |
| 4 | `id` | `#email` |
| 5 | `name` (radios and checkboxes add their `value`) | `[name="plan"][value="pro"]` |
| 6 | Position: tag + index among same-tag siblings, up to the nearest ancestor that has a key from 1–5 (or `<body>`) | `#add > form > div > button:nth-of-type(2)` |

The built-in list of rule 3 is exported as `BUILTIN_IDENTITY_ATTRIBUTES`.

Visible text (role + accessible name, e.g. `button "Save"`) is shown in the report as the element's **label** only. When the name changed between runs or instances, the label shows `(+N variants)`.

## Keys are computed at report time

Keys are computed when the report is built, from the recorded attributes, so changing `significantAttributes`, `attributeFilters` or `elements` only needs a [rebuild](./how-it-works.md#rebuilding-the-report). Attribute values that look generated (React `useId` values, UUIDs, framework counters such as `mui-12345`) are skipped for rules 2–5; [`attributeFilters`](./rules.md#attributefilters) lists the built-in rules and lets you add your own.

## Positional keys

Positional keys read like CSS selectors and only use an index when there are several siblings with the same tag. Table rows (`<tr>`, `role="row"`) never get an index, so a "Delete" button on every row is one element with several instances (unless `autoGroup: { rows: false }`).

Positional keys change when the markup around the element changes. For anything that matters, add a `data-testid` (or a `data-uicov-id`), or pin it with a [named element](./rules.md#named-elements) rule in the config.

## Keys in frames and shadow roots

Elements inside iframes and shadow roots get the key of the frame element or shadow host as a prefix, joined with ` >> `: `iframe[data-testid="payments"] >> [data-testid="card"]`. See [Iframes and shadow DOM](./iframes-shadow-dom.md#keys).

## Same key, one element

Elements that share a key are one element. [Element grouping](./element-grouping.md) goes further: it merges elements with *different* keys that are really one control repeated (the "Add to cart" button of every product card), and splits elements that share a key but are different controls (the "Submit" of a login form and of a signup form).

## Making identity explicit

| You want | Use |
|---|---|
| A stable key for one element, in the markup | `data-testid="save"` (or another test-id attribute), or `data-uicov-id="checkout-submit"` |
| A stable key and a readable name, without touching the markup | an [`elements`](./rules.md#named-elements) rule in the config |
| Your own identifying attribute (`data-component`) | [`significantAttributes`](./rules.md#significantattributes) |
| Ignore generated ids your framework produces | [`attributeFilters`](./rules.md#attributefilters) |
| Several elements counted as one | `data-uicov-group` or `elementGroups`, see [Element grouping](./element-grouping.md) |
