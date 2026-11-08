# Which elements count

This page lists the rules that decide which elements are counted as interactive, how to override them in your markup, and which interactions mark an element tested.

These rules run in the browser while the tests run, because they need the live page. To leave elements out (or keep them in) afterwards, use [report-time rules](./rules.md) such as `elementFilters`.

## Interactive elements

An element counts if it is visible in at least one inventory and one of these applies:

- **Interactive HTML** ([WHATWG interactive content](https://html.spec.whatwg.org/multipage/dom.html#interactive-content)): `a[href]`, `button`, `input` (not `type=hidden`), `select`, `textarea`, `<summary>` of a `<details>`, `audio`/`video` with `controls`, and contenteditable editing hosts.
- **ARIA widget roles**: `button`, `checkbox`, `combobox`, `link`, `listbox`, `menuitem`, `menuitemcheckbox`, `menuitemradio`, `option`, `radio`, `scrollbar`, `searchbox`, `slider`, `spinbutton`, `switch`, `tab`, `textbox`, `treeitem`. Composite containers (`menu`, `tablist`, `tree`, `grid`, …) don't count themselves; their items do.
- **`tabindex` ≥ 0** (e.g. a clickable `<div class="card" tabindex="0">`). `tabindex="-1"` alone doesn't count.
- **`draggable="true"`**.
- **Scroll containers** (`overflow: auto|scroll` with content that overflows), when `scroll` interactions are recorded. They only receive `scroll` credit; a click on text inside a scrollable panel doesn't mark the panel tested.

Links are special: most `<a href>` elements are counted by destination instead of by clicks, see [Links and untested views](./links.md).

## Never counted

- `<a href="tel:…">`, `mailto:` and `sms:` links: they hand off to another app.
- `<label>`: clicking a label activates its control, and the control is what gets credited (once; the browser forwards the click). Other events on a label (`dblclick`, `contextmenu`, …) are credited to the control too.
- `<iframe>`, `<embed>`, `<object>` themselves: their content is a separate document. The elements inside an iframe count on their own, see [Iframes and shadow DOM](./iframes-shadow-dom.md).
- `<option>` inside a `<select>` (the `select` counts), and elements inside a contenteditable editor (the editor counts).

## Nested widgets count once, as the inner ones

A widget that contains other widgets (a `tabindex=0` card with a "Like" and a "Share" button, a `role=combobox` wrapper around an `<input>`) is not counted itself. The inner elements are the actual controls, the ones `getByRole` finds, and counting only the outer one would merge distinct controls into one element.

A click on the outer element's own area credits its inner widget if it has exactly one (it's the same control), and nothing if it has several. Widgets inside a grouping role (`group`, `menu`, `listbox`, `tree`, …) are separate widgets: a tree item with a nested group of child items still counts.

## Markup overrides

`data-uicov-interactive` on an element or an ancestor changes the rules. The closest element with a directive that applies wins:

| Value | Effect |
|---|---|
| `include` | This element counts, even if no rule says so (e.g. a `<div>` drop zone with a click handler). Also exempt from the nesting rule. |
| `exclude` | This element doesn't count (its descendants still can). |
| `exclude-all` | Nothing in this subtree counts. `data-uicov-ignore` and the deprecated `ignoreSelectors` are aliases. |
| `reset` | Stop inheriting: inside an `exclude-all` subtree, the normal rules apply again. |

```html
<div class="drop-zone" data-uicov-interactive="include">Drop files here</div>
<aside data-uicov-ignore>…</aside>
```

Markup directives are applied while recording, so a report-time `elementFilters` rule can't bring back an element the markup excludes, nor make a non-interactive element count.

## Interaction types

An element is tested when a counted test performs one of these interactions on it:

| Event | Counts when | Default |
|---|---|---|
| `click`, `dblclick`, `contextmenu` | the element is clicked, double-clicked, right-clicked | on |
| `input`, `change` | text is typed, an option picked, a checkbox toggled, a file selected | on |
| `submit` | a form is submitted; credited to its submit button (`SubmitEvent.submitter`), also when submitted with Enter | on |
| `keydown` | **Enter** or **Space** is pressed on a focused element (keyboard activation). Typing in a text field doesn't count here (that's `input`) | on |
| `scroll` | a scroll container is scrolled. A burst of scroll events (less than 500 ms apart) counts once | **off**: Playwright scrolls elements into view before acting on them, which would mark scroll containers tested |
| `dragstart`, `drop` | an element is dragged; an element receives a drop. Mark a plain `<div>` drop zone with `data-uicov-interactive="include"` so it counts | on |
| `focus`, `blur` | the element gains or loses focus | **off**: tabbing through a form would mark every field tested |

A Playwright `dblclick()` also fires two `click`s, and `press('Enter')` on a button fires `keydown` and `click`; each is recorded under its own type. Hover-only interactions aren't counted.

Choose the types with the `interactions` recording option, and narrow them per element with `allowedInteractions`:

```ts
// ui-coverage.config.ts
import { DEFAULT_INTERACTIONS, defineUiCoverageConfig } from 'playwright-ui-coverage';

export default defineUiCoverageConfig({
  recording: {
    interactions: [...DEFAULT_INTERACTIONS, 'focus'],
    allowedInteractions: [
      { selector: '.date-picker input', events: ['change'], comment: "focusing or clicking it doesn't count" },
    ],
  },
});
```

- **`interactions`**: the events that count. Unknown names fail the run with the list of supported ones. `DEFAULT_INTERACTIONS` and `INTERACTION_TYPES` are exported.
- **`allowedInteractions`**: `{ selector, events }` rules. For an element matching `selector` (the first matching rule wins), only `events` count, replacing `interactions`. The events listed here are recorded even if `interactions` leaves them out.

Interaction types are recording options: events that aren't listened to can't be recovered later, so changing them needs a new test run. See [Recording options](../reference/recording-options.md).

In `coverage.json`, each element has `interactionCounts`: the interactions that counted as tested, by type (`{ "click": 3, "input": 1 }`), and `testIds` / `failingTestIds`, the Playwright test ids (`TestCase.id`) of the tests that touched it, which point into the top-level `tests` array (see [coverage.json](../coverage-json.md)).
