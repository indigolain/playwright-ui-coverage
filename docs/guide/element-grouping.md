# Element grouping

This page explains when several elements are counted as one (the "Add to cart" button of every product card), when elements that share a key are split, and how to control both.

A group is one element of the view: it counts once in the score, is tested when a test interacts with any member, and is listed as `label (N instances)` in the report (`instances` and `group` in [`coverage.json`](../coverage-json.md#viewselements-elementcoverage)). Its members' boxes on the screenshots all point at it.

## The rules

The first rule that applies to an element decides:

| # | Rule | Key of the group | `group.reason` |
|---|---|---|---|
| 1 | **`data-uicov-group="name"`** on the element or an ancestor (also across frames and shadow roots; the closest one wins). Every element with the same name is one group, even a single one. An empty value (`data-uicov-group=""`) turns all grouping off for that subtree. | `[data-uicov-group="name"]` | `markup` |
| 2 | **`elementGroups`** in the config: the first entry whose selector matches the element or an ancestor. A group even with one match. `exclude: true` turns grouping off instead. | the entry's selector | `config` |
| 3 | **Form boundary**: elements that share a key but are in different forms (`<form>`, `role="form"`), or in and out of one, are one element per form. Keys only change when there's such a conflict in the view. | `#signup [data-testid="submit"]` (the form's key, a space, the key) | — |
| 4 | **Table rows**: controls in the same column/position of the rows (`<tr>`, `role="row"`) of a `<table>` or `role="grid"`/`"table"`/`"treegrid"`, whatever their own attributes (`id="edit-42"`) or names ("Edit Ada"). | the table's key, then the position with rows unindexed: `[data-testid="users"] > tbody > tr > td:nth-of-type(3) > button` | `row` |
| 5 | **Repeated structures**: elements with the same shape at the same depth: the same chain of tags and classes from the page top down (class tokens containing digits ignored), the same role and the same accessible name, and their own identity equal once digits are ignored (`data-testid="add-to-cart-1"` and `"add-to-cart-2"` match, `"profile-edit"` and `"billing-edit"` don't). Ancestor forms must have the same identity and `action`, so identical login and signup forms aren't merged. | positional, from the deepest ancestor identity all members share, with an index only where all members agree: `[data-testid="products"] > li > div > button:nth-of-type(1)` | `repeated` |
| 6 | **Labels**: a `<label>` that counts (e.g. `tabindex="0"`) is merged into its control (`for`, or the control inside it), since its events are credited to the control anyway. Not counted as an instance. | the control's key | `label` |

Elements that share a key without any of these (the same `data-testid` on every row) are reported with `group.reason: "same-key"`.

## The heuristics are conservative

The heuristics (rules 4–6) only group **two or more** elements of the view, from all tests together (a list with one card in one test and three in another still forms one group). They are deliberately conservative:

- Links (`<a href>`) aren't grouped by rows or structure: a link to another view is already one [link unit](./links.md) per destination view, whatever the number of links. Elements with a `data-uicov-id` (an explicit identity) aren't grouped automatically either; explicit groups (rules 1–2) apply to both.
- Repeated structures need an accessible name, and the same one: navigation items ("Home", "Users") and toolbar buttons have different names, so they stay separate. Nothing inside `<nav>`, `<menu>` or `role="navigation"`/`menu`/`menubar`/`tablist`/`toolbar`/`radiogroup`/`listbox`/`tree` is grouped this way.
- Limits: two unrelated controls with identical names and markup structure (two "Edit" buttons in two identical, unnamed panels) are grouped; give one a `data-testid` with a word in it, or use `data-uicov-group=""`. Names that change per item ("Add Desk lamp to cart") prevent a repeated-structure group; use `data-uicov-group` or `elementGroups`. Group keys of rules 4–5 are positional, so they change with the markup like any positional key.

## Configure grouping

In the markup:

```html
<li class="product" data-uicov-group="product card">…</li>  <!-- everything inside is one element -->
<section data-uicov-group="">…</section>                    <!-- no grouping in here -->
```

In the config, and turning the heuristics off, all or one by one, with `autoGroup`:

```ts
// ui-coverage.config.ts
import { defineUiCoverageConfig } from 'playwright-ui-coverage/config';

export default defineUiCoverageConfig({
  autoGroup: { repeated: false },   // or `false` for all; keys: rows, repeated, labels, forms (default: all true)
  elementGroups: [
    { selector: '.product-card', name: 'product card' },     // everything inside any card is one element
    { selector: 'button', documentScope: 'star-rating' },    // inside a shadow host or frame
    { selector: '.legacy-list li', exclude: true },          // never group these
  ],
});
```

- **`elementGroups`**: `{ selector, name?, documentScope?, exclude?, comment? }` entries. The elements matching `selector`, or inside an element that does, are one element, even when there's only one; the first matching entry wins, and `data-uicov-group` in the markup wins over all of them. `name` is shown in the report (default: the selector); the key is the selector. `exclude: true`: matching elements are never grouped. Selectors follow the [report-time selector](./rules.md#report-time-selectors) rules; `documentScope` is explained [there too](./rules.md#documentscope).
- **`autoGroup`**: `false` turns the automatic grouping heuristics off, or `{ rows, repeated, labels, forms }` turns them off one by one (each defaults to `true`).

With `rows: false`, table rows get an index in positional keys (`tr:nth-of-type(2)`), and rows are only grouped if they qualify as repeated structures.

Grouping is applied at report time, so a [rebuild](./how-it-works.md#rebuilding-the-report) shows the effect of a change without running the tests.
