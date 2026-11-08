# playwright-ui-coverage

See which buttons, links and inputs your Playwright E2E tests **actually touch**, as screenshots with green (tested) and red (untested) overlays, a coverage % per page, and the tests that covered each element.

> Status: early development (0.1.0). APIs may change.

![UI coverage report: route list with coverage %, a screenshot of the /users page with green boxes on tested elements and red boxes on untested ones](docs/report-overview.png)

## What you get

**Every page your tests visit, with each interactive element marked.** Green means a test clicked or typed into it, red means no test did. The sidebar shows coverage per route, and dynamic segments are grouped (`/users/1`, `/users/2` → `/users/:id`).

**Find what's missing.** Turn on *Untested only* to hide everything that's already covered:

![Settings page with only the untested elements outlined in red: theme select, bio textarea, reset and delete account buttons, nav links](docs/report-untested-only.png)

**See where each element is, and which tests cover it.** Hover a row to highlight that element on the screenshot. Repeated elements such as a "Delete" button on every row are grouped into one entry:

<img src="docs/report-hover.png" alt="Hovering the 'button Delete ×3' row highlights all three Delete buttons on the screenshot in orange; the table lists each element with its status and the tests that covered it" width="720">

**Jump to the test and its trace.** With Playwright's HTML reporter configured, each test under "Tested by" links to its entry in the HTML report, and to its trace when one was recorded. See [Links to the HTML report and traces](#links-to-the-html-report-and-traces).

**Spot repeated setup.** The element table shows how many times each element was used (**Interactions**) and by how many tests (**Tests**); click either header to sort by it. **Most repeated elements** in the sidebar lists the elements used by the most tests across the report, such as a login form that every test fills in first.

**Write the missing tests faster.** Each untested element has a ready-to-paste Playwright line with a *Copy* button, and *Copy untested as test skeleton* gives you a whole test for the route. Click an element's box on the screenshot to jump to its row. Elements also get small, informational **accessibility hints** (no accessible name, links with the same name going to different places, controls keyboard users can't reach):

<img src="docs/report-locators.png" alt="The /users/:id table: each untested element has a suggested locator such as await page.getByRole('button', { name: 'Edit' }).click(); with a Copy button, and blue accessibility hints such as 'No accessible name' under some elements" width="720">

**Large suites.** Filter routes by name (press `/`), sort them by name, lowest coverage or most untested elements, and screenshots load lazily. A synthetic report with 300 routes × 80 elements opens in about 0.1 s and switching routes takes a few milliseconds (`npm run perf` to measure).

**Dark mode** follows your system setting:

<img src="docs/report-dark.png" alt="The report in dark mode showing the home page" width="720">

## Quick start

```bash
npm i -D playwright-ui-coverage
```

There are two ways to turn recording on. Both use the same reporter and produce the same results.

### Option A: config only (experimental, no test changes)

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import 'playwright-ui-coverage/register'; // ← records every browser context in every test

export default defineConfig({
  reporter: [
    ['list'],
    ['playwright-ui-coverage/reporter', { outputFolder: 'ui-coverage-report' }],
  ],
});
```

This is the quickest way to try it on an existing suite. It hooks into Playwright's internal instrumentation, the same hook Playwright's trace recorder uses. That API is private, so if a Playwright release changes it, register mode switches itself off with a warning (set `UICOV_STRICT=1` to make that an error, e.g. in CI). Option B keeps working either way.

### Option B: fixture (stable, recommended for long-term use)

Merge `uiCoverage` into your own fixtures with Playwright's `mergeTests`:

```ts
// tests/fixtures.ts
import { mergeTests } from '@playwright/test';
import { uiCoverage } from 'playwright-ui-coverage';
import { test as appTest } from './my-fixtures';

export const test = mergeTests(appTest, uiCoverage);
export { expect } from '@playwright/test';
```

No fixtures of your own? Import `test` directly instead: `import { test, expect } from 'playwright-ui-coverage'`.

Then add the reporter the same way as in Option A.

Either way, recording covers every page and popup in the test's browser context. It adds **no steps** to your HTML report or trace, because its calls are marked as internal.

**3. Run your tests** and open `ui-coverage-report/index.html`.

```
UI coverage: 40.4% (23/57 elements)
  /              50%  4/8
  /settings      30%  3/10
  /users         50%  6/12
  /users/:id    9.1%  1/11
  /widgets     56.3%  9/16
  9 accessibility hint(s), informational (see the report)
```

## How it works

1. **Tracker** (`addInitScript`): capture-phase listeners record every interaction (`click`, `input`, `change`, `submit`, `dblclick`, `contextmenu`, keyboard activation, drag and drop, opt-in `scroll`/`focus`/`blur`, see [Interaction types](#interaction-types)) on an [interactive element](#which-elements-count), whichever Playwright API (or a real user) caused it.
2. **Inventory + screenshot**: when a page loads and shortly after interactions, the recorder lists every visible interactive element (with bounding boxes) and takes a full-page screenshot. It only takes a new screenshot when new elements appear. It records **raw facts** (tag, attributes, position among siblings, ancestors, accessible name), not keys: identity and filtering are decided later.
3. **Reporter**: merges data from all workers, applies the [report-time rules](#report-time-rules-reporter-options) (filters, identity), groups by route (`/users/42` → `/users/:id`), marks an element *tested* if any test interacted with it, and renders the HTML report and `coverage.json`. It also saves the raw data in `ui-coverage-report/data/`, so you can [rebuild the report](#rebuilding-the-report-report-cli) with other rules without running the tests again.

### Which elements count

An element counts if it is visible in at least one inventory and one of these applies:

- **Interactive HTML** ([WHATWG interactive content](https://html.spec.whatwg.org/multipage/dom.html#interactive-content)): `a[href]`, `button`, `input` (not `type=hidden`), `select`, `textarea`, `<summary>` of a `<details>`, `audio`/`video` with `controls`, and contenteditable editing hosts.
- **ARIA widget roles**: `button`, `checkbox`, `combobox`, `link`, `listbox`, `menuitem`, `menuitemcheckbox`, `menuitemradio`, `option`, `radio`, `scrollbar`, `searchbox`, `slider`, `spinbutton`, `switch`, `tab`, `textbox`, `treeitem`. Composite containers (`menu`, `tablist`, `tree`, `grid`, …) don't count themselves; their items do.
- **`tabindex` ≥ 0** (e.g. a clickable `<div class="card" tabindex="0">`). `tabindex="-1"` alone doesn't count.
- **`draggable="true"`**.
- **Scroll containers** (`overflow: auto|scroll` with content that overflows), when `scroll` interactions are recorded. They only receive `scroll` credit; a click on text inside a scrollable panel doesn't mark the panel tested.

Never counted:

- `<a href="tel:…">`, `mailto:` and `sms:` links: they hand off to another app.
- `<label>`: clicking a label activates its control, and the control is what gets credited (once, the browser forwards the click). Other events on a label (`dblclick`, `contextmenu`, …) are credited to the control too.
- `<iframe>`, `<embed>`, `<object>`: their content is a separate document, and clicks inside it never reach the parent page.
- `<option>` inside a `<select>` (the `select` counts), and elements inside a contenteditable editor (the editor counts).

**Nested widgets count once, as the inner ones.** A widget that contains other widgets (a `tabindex=0` card with a "Like" and a "Share" button, a `role=combobox` wrapper around an `<input>`) is not counted itself. The inner elements are the actual controls, the ones `getByRole` finds, and counting only the outer one would merge distinct controls into one element. A click on the outer element's own area credits its inner widget if it has exactly one (it's the same control), and nothing if it has several. Widgets inside a grouping role (`group`, `menu`, `listbox`, `tree`, …) are separate widgets: a tree item with a nested group of child items still counts.

**Markup overrides.** `data-uicov-interactive` on an element or an ancestor changes the rules. The closest element with a directive that applies wins:

| Value | Effect |
|---|---|
| `include` | This element counts, even if no rule says so (e.g. a `<div>` drop zone with a click handler). Also exempt from the nesting rule. |
| `exclude` | This element doesn't count (its descendants still can). |
| `exclude-all` | Nothing in this subtree counts. `data-uicov-ignore` and `ignoreSelectors` are aliases. |
| `reset` | Stop inheriting: inside an `exclude-all` subtree, the normal rules apply again. |

### Element identity

Elements are matched across tests by **attributes and position, never by visible text**, so copy changes, translations and dynamic text (counters, user names, timestamps) don't turn one element into a new one. The first rule that applies gives the element's key:

| # | Source | Key in the report |
|---|---|---|
| 1 | `data-uicov-id` (explicit override, never filtered) | `checkout-submit` (the value as-is) |
| 2 | `significantAttributes` you configure, in order | `[data-component="avatar"]` |
| 3 | `data-testid`, `data-test`, `data-test-id`, `data-cy`, `data-qa`, `row-id` | `[data-testid="save"]` |
| 4 | `id` | `#email` |
| 5 | `name` (radios/checkboxes add their `value`) | `[name="plan"][value="pro"]` |
| 6 | Position: tag + index among same-tag siblings, up to the nearest ancestor that has a key from 1–5 (or `<body>`) | `#add > form > div > button:nth-of-type(2)` |

Keys are computed when the report is built, from the recorded attributes, so changing `significantAttributes` or `attributeFilters` only needs a [rebuild](#rebuilding-the-report-report-cli). Attribute values that look generated (rules 2–5) are skipped, see `attributeFilters` below. Visible text (role + accessible name, e.g. `button "Save"`) is shown in the report as the element's **label** only.

Positional keys read like CSS selectors and only use an index when there are several siblings with the same tag. Table rows (`<tr>`, `role="row"`) never get an index, so a "Delete" button on every row is one element with several instances. Positional keys change when the markup around the element changes, so for anything that matters, add a `data-testid` (or a `data-uicov-id`).

## Options

Options come in two places:

- **Report-time rules** (which elements count, how they're identified) are **reporter options**. They're applied when the report is built, so you can change them and [rebuild the report](#rebuilding-the-report-report-cli) without running the tests.
- **Recording options** (`use.uiCoverage`) control what is captured while tests run: on/off, timing, screenshots, interaction types.

### Report-time rules (reporter options)

```ts
// playwright.config.ts
reporter: [
  ['playwright-ui-coverage/reporter', {
    ignoreSelectors: ['.cookie-banner', '#debug-toolbar *'], // default: []
    significantAttributes: ['data-component'],              // default: []
    attributeFilters: [                                      // default: []
      { attribute: 'id', value: 'tmp-.*' },                  // ignore id="tmp-…"
      { attribute: 'id', value: 'mui-legacy', include: true }, // keep, despite the built-in rule
    ],
  }],
],
```

To share them with the `report` CLI, keep them in their own file and spread it into the reporter options, e.g. `...require('./ui-coverage.config.json')` (the demo does this with `demo/ui-coverage.config.json`). The type is exported as `UiCoverageRules`.

- **`ignoreSelectors`**: elements matching one of these selectors, or inside an element that does, are excluded. Same rules as `data-uicov-interactive="exclude-all"` (a `reset` inside stops it, an element's own `include` wins). Anything inside `data-uicov-ignore` is always excluded. Selectors are evaluated on the recorded structure, see [Report-time selectors](#report-time-selectors). One difference from excluding in the markup: the [nesting rule](#which-elements-count) is decided while recording, so excluding all inner widgets of a container widget doesn't make the container count.
- **`significantAttributes`**: attributes that identify an element, checked after `data-uicov-id` and before the built-in test-id attributes, in the order given.
- **`attributeFilters`**: `{ attribute, value?, include? }` rules deciding whether an attribute value may be used as a key. `attribute` and `value` are regular expressions, anchored automatically (`'id'` means `^(?:id)$`). Attribute names match case-insensitively, values case-sensitively. Without `value`, the rule matches any value. The first matching rule wins: `include: false` (default) skips the value, `include: true` keeps it. Your rules run before the built-in ones, which skip:
  - React `useId` values (`:r1:`, `:R2kq:`, `«r1»`), UUIDs and hex strings of 16+ characters, in any attribute;
  - in `id` and `name`: framework counters (`ember123`, `mui-12345`, `radix-…`, `headlessui-…`, `react-aria-…`, `downshift-…`, `react-select-…`, `mat-…-0`, `cdk-…-3`, `ui-id-4`, `ext-gen12`, `gwt-uid-3`, `yui_…`, `j_id…`), purely numeric values and values with 3+ consecutive digits.

  The built-in lists are exported as `BUILTIN_IDENTITY_ATTRIBUTES` and `BUILTIN_ATTRIBUTE_FILTERS`.

#### Report-time selectors

Selector rules run in Node on the recorded DOM structure (each element with its attributes, its position among same-tag siblings and its ancestors), not in the browser. Supported:

- type (`button`), `*`, `#id`, `.class`, attribute selectors (`[a]`, `[a=v]`, `~=`, `|=`, `^=`, `$=`, `*=`, with the ` i` / ` s` flags);
- descendant (` `) and child (`>`) combinators, selector lists (`,`);
- `:not()`, `:is()`, `:where()`, `:nth-of-type()`, `:nth-last-of-type()`, `:first-of-type`, `:last-of-type`, `:only-of-type`, `:root`.

Not supported, because the data needed isn't recorded: sibling combinators (`+`, `~`), `:has()`, `:nth-child()` and friends, state pseudo-classes (`:checked`, `:hover`, `:disabled`, …). An unsupported selector fails the run (or the CLI) with a message saying which part isn't supported. Attribute values are recorded up to 256 characters (`class` up to 1024), and `style` isn't recorded.

#### Deprecated: rules in `use.uiCoverage`

`ignoreSelectors`, `significantAttributes` and `attributeFilters` used to be recording options. In `use.uiCoverage` they still work, but are deprecated:

- `significantAttributes` and `attributeFilters` are recorded with the data and applied at report time. If the reporter options set the same rule (even to `[]`), the reporter's value wins.
- `ignoreSelectors` is applied while recording (as before, with any CSS the browser supports), so it can't be undone at report time.

Move them to the reporter options to change them without re-running tests. When you do, pass them to `merge-reports` too (see [Sharding](#sharding-and-merge-reports)).

### Recording (`use.uiCoverage`, works in both modes)

```ts
import { defineConfig } from '@playwright/test';
import { DEFAULT_INTERACTIONS, type UiCoverageOptions } from 'playwright-ui-coverage';

export default defineConfig<{ uiCoverage: Partial<UiCoverageOptions> }>({
  use: {
    uiCoverage: {
      enabled: !!process.env.UI_COVERAGE, // default: true
      snapshotDelay: 250,                  // ms, default: 250
      screenshots: 'on',                   // 'on' | 'first-only' | 'off', default: 'on'
      format: 'jpeg',                      // 'png' | 'jpeg', default: 'png'
      quality: 80,                         // JPEG quality 0-100, default: 80
      maxScreenshotHeight: 8000,           // CSS px, 0 = no cap, default: 8000
      interactions: [...DEFAULT_INTERACTIONS, 'focus'], // default: DEFAULT_INTERACTIONS
      allowedInteractions: [               // default: []
        { selector: '.date-picker input', events: ['change'] }, // focusing or clicking it doesn't count
      ],
    },
  },
});
```

- **`interactions`**: the events that count, see below. Unknown names fail the run with the list of supported ones.
- **`allowedInteractions`**: `{ selector, events }` rules. For an element matching `selector` (the first matching rule wins), only `events` count, replacing `interactions`. The events listed here are recorded even if `interactions` leaves them out.

#### Interaction types

| Event | Counts when | Default |
|---|---|---|
| `click`, `dblclick`, `contextmenu` | the element is clicked, double-clicked, right-clicked | on |
| `input`, `change` | text is typed, an option picked, a checkbox toggled, a file selected | on |
| `submit` | a form is submitted; credited to its submit button (`SubmitEvent.submitter`), also when submitted with Enter | on |
| `keydown` | **Enter** or **Space** is pressed on a focused element (keyboard activation). Typing in a text field doesn't count here (that's `input`) | on |
| `scroll` | a scroll container is scrolled. A burst of scroll events (less than 500 ms apart) counts once | **off**: Playwright scrolls elements into view before acting on them, which would mark scroll containers tested |
| `dragstart`, `drop` | an element is dragged; an element receives a drop. Mark a plain `<div>` drop zone with `data-uicov-interactive="include"` so it counts | on |
| `focus`, `blur` | the element gains or loses focus | **off**: tabbing through a form would mark every field tested |

`DEFAULT_INTERACTIONS` and `INTERACTION_TYPES` are exported. A Playwright `dblclick()` also fires two `click`s, and `press('Enter')` on a button fires `keydown` and `click`; each is recorded under its own type.

Interaction types are recording options: events that aren't listened to can't be recovered later.

Each element's `role`, accessible `name` and where the name came from (`nameFrom`: `aria-labelledby`, `aria-label`, `label`, `placeholder`, `title`, `alt`, `value`, `text`, or `name` for the name attribute) are recorded too, and `coverage.json` lists them with the element's identifying attributes (`attrs`: `id`, `name`, `role`, `type`, `aria-label`, `href`, `tabindex`, `contenteditable`, `data-*` and your `significantAttributes`). Suggested locators and accessibility hints are built from these.

Screenshot options:

| Option | Default | Description |
|---|---|---|
| `screenshots` | `'on'` | `'on'`: screenshot whenever a page state shows elements no screenshot has shown yet. `'first-only'`: at most one screenshot per URL per test. `'off'`: no screenshots; the report shows the element tables only. Elements are counted in every mode. |
| `format` | `'png'` | `'jpeg'` files are usually several times smaller. |
| `quality` | `80` | JPEG quality (ignored for PNG). |
| `maxScreenshotHeight` | `8000` | Full-page screenshots of taller pages are cropped to this height. Elements below the crop are still counted, just not drawn on the image. `0` disables the cap. |

In `coverage.json`, each element has `interactionCounts`: the interactions that counted as tested, by type (`{ "click": 3, "input": 1 }`). The report shows them as the tooltip of the *tested* label and of the Interactions cell. Each element also lists `testIds` / `failingTestIds`, the Playwright test ids (`TestCase.id`) of the tests that touched it, which point into the top-level `tests` array (see [coverage.json](#coveragejson)).

### Reporter

| Option | Default | Description |
|---|---|---|
| `outputFolder` | `ui-coverage-report` | Report location (relative to the config file). |
| `normalizeUrl` | strips query, ids → `:id` | `(url) => routeName`, to group pages your own way. |
| `maxScreenshotsPerRoute` | `3` | Screenshots chosen to cover the most elements. |
| `threshold` | none | Fail the run if coverage % is below this: a number (overall), or `{ overall, views }` for per-view minimums. See below. |
| `countFailedTests` | `false` | Let interactions from tests that didn't pass mark elements as tested. See below. |
| `testIdAttribute` | from config | Attribute for `getByTestId()` in suggested locators. Default: the `use.testIdAttribute` of the first project that sets one, else `data-testid`. See below. |
| `viewBy` | `'auto'` | Group views by page URL (`'url'`) or by spec file (`'file'`). `'auto'` picks `'file'` for component tests. See [Component testing](#component-testing). |
| `htmlReport` | detected | Folder of Playwright's HTML report (relative to the config file) that "Tested by" links to. Detected from the `html` reporter in the config; `false` turns the links off. See below. |
| `saveData` | `true` | Keep the raw data and every screenshot in `<outputFolder>/data/` for the [`report` CLI](#rebuilding-the-report-report-cli). |
| `baseline` | none | Fail only on *new* untested elements, compared with a committed baseline file. See [Baseline](#baseline-fail-only-on-new-untested-elements). |
| `githubSummary` | `false` | Append a markdown summary to `$GITHUB_STEP_SUMMARY` when it's set. See [Comparing runs](#comparing-runs-pr-comments-and-the-github-step-summary). |
| `ignoreSelectors`, `significantAttributes`, `attributeFilters` | `[]` | [Report-time rules](#report-time-rules-reporter-options). |

### Links to the HTML report and traces

When the config also has Playwright's `html` reporter, each test under "Tested by" links to its entry in the HTML report (`index.html#?testId=<id>&run=<attempt>`): for a flaky test the retry that passed, for a test that never passed its last attempt. If that attempt recorded a trace (`use: { trace: 'on' }` or similar), a **trace** link opens it in the trace viewer bundled with the HTML report. The reporter reads the HTML reporter's `outputFolder` (and `PLAYWRIGHT_HTML_OUTPUT_DIR`, `attachmentsBaseURL`) from the config. Without the `html` reporter, tests are listed as plain text.

Links are relative, so the two reports must keep their relative position when you move or upload them. Two layouts work:

```ts
// 1. Side by side (default): playwright-report/ and ui-coverage-report/
reporter: [['html'], ['playwright-ui-coverage/reporter']],

// 2. Inside the HTML report, served together by `npx playwright show-report`.
//    List the html reporter first: it clears its folder when it writes.
reporter: [['html'], ['playwright-ui-coverage/reporter', { outputFolder: 'playwright-report/ui-coverage' }]],
```

- **Test links** work from `file://` too.
- **Trace links** need the reports served over `http(s)`, like the HTML report's own trace links (the trace viewer can't load from `file://` and says so). With layout 2, `npx playwright show-report` serves both; with layout 1, serve the folder that contains both with any static file server.
- Traces are never sent anywhere: the link uses the HTML report's own copy of the trace viewer, not trace.playwright.dev.
- **`merge-reports`:** pass both reporters in a merge config (`--config merge.config.ts`). With `--reporter html,playwright-ui-coverage/reporter` on the command line the reporter can't see the HTML reporter's options, so there are no links.
- The trace viewer can't open at a given time or action from a URL, so links open the trace at its start.

Each trace is identified by the file name the HTML reporter gives it (SHA-1 of its content), computed only when the HTML report is linked.

### Most repeated elements

Elements used by many tests are often setup steps (signing in, creating data) rather than what those tests check. **Most repeated elements** in the sidebar lists them with their number of tests and interactions; click a route to see the element on its page. If a step there isn't what most of those tests are about, you can do it once instead: [authenticate in a setup project and reuse the `storageState`](https://playwright.dev/docs/auth), or [prepare data through the API](https://playwright.dev/docs/api-testing#using-request-context), and keep one test that goes through the UI.

### Suggested locators

For every element, `coverage.json` has a `suggestedLocator`: one line of Playwright code that interacts with it. The report shows it (with a *Copy* button) for untested elements. It's built from the recorded data, deterministically, picking the first that applies:

1. `page.getByTestId('…')` if the element has the test id attribute. That's `use.testIdAttribute` from your Playwright config (or the reporter's `testIdAttribute` option), default `data-testid`. An attribute that doesn't start with `data-` is only recorded if it's in `significantAttributes`.
2. If the accessible name changed between runs or instances (the label shows `(+N variants)`), or another element with the same role has the same name on this view: `page.locator('<key>')`, the element's key as a CSS selector.
3. `page.getByRole(role, { name })`. Names from attributes and `<label>`s match exactly (`exact: true`); names from text content match like Playwright's default (case-insensitive substring), or as `/^…$/i` when that would also match a longer name on the view ("Save" and "Save draft").
4. `page.getByLabel(…)`, `page.getByPlaceholder(…)`, `page.getByTitle(…)`, `page.getByText(…)` when the name came from there and there's no usable role (a placeholder or title as the only name always uses these).
5. `page.locator('<key>')` otherwise. Positional keys get a `body > ` prefix.

The action follows the element: `click()` for buttons and links, `fill('…')` for text fields (with a sample value for `email`, `number`, `date`… inputs), `check()` for checkboxes, radios and switches, `selectOption('…')` for `<select>`, `setInputFiles('path/to/file')` for file inputs. Repeated elements (`×3`) get `.first()` and a comment on how to narrow it.

*Copy untested as test skeleton* produces (shortened):

```ts
test('covers untested elements on /settings', async ({ page }) => {
  await page.goto('/settings');
  // TODO: a line that navigates away (link, submit) ends this page state: split into more tests or goto() again.
  await page.getByTestId('delete-account').click();
  // TODO: assert the result
  await page.getByRole('textbox', { name: 'Bio', exact: true }).fill('…');
  // TODO: assert the result
});
```

If the browser blocks clipboard access (some do for `file://` pages), the text opens in a dialog, selected, to copy by hand.

Suggestions are a starting point. Elements inside a closed dialog or menu need the steps that open it first, and a name with per-run text (a timestamp, a counter) that a run saw only once can't be detected as changing.

### Accessibility hints

Informational only: they don't change the coverage score or fail a run. The report shows them in blue under the element, with a count per route; `coverage.json` has `a11yHints: [{ rule, message }]` on elements that have any, and an `a11yHintsCount` per view and in total.

| Rule | When |
|---|---|
| `no-name` | The control has no accessible name: no `<label>`, `aria-label(ledby)`, `title`, `alt` or (for buttons and links) text. A `name` attribute or a `<select>`'s options don't count. |
| `placeholder-only` | A field is named only by its placeholder. |
| `duplicate-name` | Links on the same view with the same name (case-insensitive) but different `href`s, e.g. several "Read more". |
| `not-focusable` | An ARIA role on an element that isn't focusable (`<div role="button">` without `tabindex`). |
| `no-role` | A plain element counted as interactive because of its `tabindex` or `data-uicov-interactive="include"`, with no role: screen readers don't announce it as a control. |

What it can't see: elements that are clickable only through a JS handler and have no role, `tabindex` or `data-uicov-interactive` (they aren't recorded at all), instances that share a key (only one instance's `href` is recorded, so a "View" link on every table row isn't compared), and names the browser computes differently from the tracker's approximation. For a full audit, use a dedicated tool such as axe.

### Thresholds

```ts
['playwright-ui-coverage/reporter', {
  threshold: {
    overall: 70,
    views: { '/checkout': 95, '/login': 95, '/admin/*': 50 },
  },
}],
```

`threshold: 70` is shorthand for `{ overall: 70 }`. If any threshold isn't met, the reporter prints each failing view with its actual and required % and the run fails (exit code 1).

- **View keys** are route names as they appear in the report (`/checkout`, `/users/:id`, after `normalizeUrl`).
- **Patterns:** `*` matches within one path segment, `**` matches across segments. A pattern applies to each matching view on its own (`/admin/*: 50` means every admin view needs 50%, not their average).
- **Precedence:** an exact key always wins over a pattern. Among patterns, the one with more literal characters wins, then the one with fewer `**`, then the one listed first.
- **Missing views:** a key or pattern that matches no view in the run prints a warning (with a "did you mean" hint for likely typos) and doesn't fail the run. A filtered run (`--grep`, one spec file) may not visit every view.

`coverage.json` has a `thresholds` array for CI tooling (empty when `threshold` isn't set):

```json
{ "scope": "view", "view": "/users/:id", "pattern": "/users/*", "required": 20, "actual": 16.7, "status": "failed" }
```

`scope` is `overall` or `view` (then `view` is the view name, or the pattern when it matched no view). `status` is `passed`, `failed` or `missing` (then `actual` is `null`; missing views only warn).

### Baseline (fail only on new untested elements)

Thresholds are hard to adopt on a suite with low coverage. A baseline is a ratchet instead: commit the list of what's untested today, and a run fails only when a view has an untested element that isn't on the list.

```ts
['playwright-ui-coverage/reporter', {
  baseline: 'ui-coverage-baseline.json',   // = { file: 'ui-coverage-baseline.json', mode: 'check' }
}],
```

```bash
npx playwright test                              # writes ui-coverage-report/coverage.json
npx playwright-ui-coverage baseline update       # writes ui-coverage-baseline.json from it; commit it
```

| `baseline` | |
|---|---|
| `'file.json'` / `true` | `{ file, mode: 'check' }`; `true` uses `ui-coverage-baseline.json`. Relative to the config file. |
| `file` | Default `ui-coverage-baseline.json`. |
| `mode` | `'check'` (default): fail on new gaps and write the current state to `<file>.next.json` (`ui-coverage-baseline.next.json`). `'update'`: rewrite `<file>` with the current state; never fails. `'off'`: nothing. |
| `allowNewViews` | Default `false`: untested elements of a view the baseline doesn't have are new gaps (a new page needs tests, or a baseline update). `true`: new views are listed but don't fail. |

**The file** lists, per view, the keys of its untested elements (sorted, one per line, so diffs review well). Views with nothing untested are kept with an empty list, so "fully tested" and "new view" stay different:

```json
{
  "baselineVersion": 1,
  "views": {
    "/settings": { "untestedElements": ["#bio", "#theme", "[data-testid=\"delete-account\"]"] },
    "/users": { "untestedElements": [] }
  }
}
```

Links get an `untestedLinks` list once they're tracked as their own units.

**What happens in check mode:**

- A view in both: its untested elements not in the baseline are **new gaps** and fail the run (exit code 1, like a threshold). Elements the baseline lists that are now tested, or gone, are **resolved**.
- **Ratchet:** `<file>.next.json` is always written with the current state. When elements got tested, the run says so; copy `.next.json` over the baseline (or run `baseline update`) and commit. Add `*.next.json` to `.gitignore`.
- **Renamed views** (a `normalizeUrl` change, a route moved): a view that disappeared and one that appeared with mostly the same untested keys (Jaccard index ≥ 0.5) are matched and compared as one, reported as `view renamed?`.
- **Removed views** (in the baseline, not in the run) are reported and never fail; a filtered run (`--grep`) doesn't visit every view. Compare against full runs: in a filtered run, a view that *was* visited can have elements that other tests normally cover.
- **No baseline file yet:** a warning, not a failure, and `.next.json` is written so you can commit it.
- Accepting a gap on purpose: commit the new state (`baseline update`), so the PR shows the added keys.

```
UI coverage baseline: 1 new untested element(s) not in ui-coverage-baseline.json:
    /settings  checkbox "Email notifications"  #notify
  Test them, or accept them by committing ui-coverage-baseline.next.json as ui-coverage-baseline.json (`npx playwright-ui-coverage baseline update`).
```

`coverage.json` has the result in `baseline` (`status`, `newGaps`, `resolved`, `addedViews`, `removedViews`, `renamedViews`; see [docs/coverage-json.md](docs/coverage-json.md#baseline-baselinecheck)).

The CLI checks or updates a baseline from an existing `coverage.json`, without running tests:

```bash
npx playwright-ui-coverage baseline check  [--report ui-coverage-report/coverage.json] [--file ui-coverage-baseline.json] [--allow-new-views] [--config <file>]
npx playwright-ui-coverage baseline update [--report ui-coverage-report/coverage.json] [--file ui-coverage-baseline.json] [--config <file>]
```

`--config` reads `outputFolder` and `baseline` from the reporter options. `check` exits with 1 on new gaps (and writes `.next.json`), 2 on errors.

### Retries and failed tests

Playwright runs a test again on retry, and every attempt records coverage. The reporter combines the attempts of each test like this:

- **Element totals** use inventories from every attempt, passed or failed. A page a failing test reached still adds its elements to the total.
- **Tested** comes from passing attempts only (by default). An attempt passes when its status is the one the test expects: `passed`, or `failed` for a `test.fail()` test. Skipped, timed-out and interrupted attempts don't pass.
- **Retries:** if any attempt of a test passed, only the last passing attempt's interactions count. For a flaky test (fails, then passes on retry) that is the retry that passed. The earlier failed attempts add element totals only.
- **Tests that never passed:** their interactions don't count as tested. Elements that only such tests touched are shown as **failing tests only** (amber) in the report. They count as untested in the percentage. In `coverage.json` these elements have `tested: false` and a non-empty `failingTestIds`, and each view and the summary have a `failingOnlyElementsCount`.
- **No duplicates:** a test is listed once under "Tested by", however many attempts it took.

With `countFailedTests: true`, interactions from every attempt count as tested, whether it passed or not.

## `coverage.json`

Next to `index.html`, the report folder has `coverage.json`: a versioned, machine-readable summary for CI gates, dashboards and PR comments. Full reference: [docs/coverage-json.md](docs/coverage-json.md).

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-01-01T12:00:00.000Z",
  "generator": { "name": "playwright-ui-coverage", "version": "0.1.0" },
  "summary": {
    "viewCount": 5, "coverage": 40.4,
    "testedElementsCount": 23, "untestedElementsCount": 34,
    "testedLinksCount": 0, "untestedLinksCount": 0,
    "failingOnlyElementsCount": 0, "a11yHintsCount": 9
  },
  "views": [
    { "name": "/users/:id", "reportUrl": "index.html#%2Fusers%2F%3Aid", "summary": { "coverage": 9.1, … }, "elements": [ … ], "screenshots": [ … ] }
  ],
  "tests": [ { "id": "…", "title": "users.spec.ts › add a user", "project": "chromium", "passed": true, "retry": 0 } ],
  "thresholds": [],
  "insights": { "mostRepeated": [] }
}
```

- **Denominator:** `coverage` is tested units / all units, where units are interactive elements plus links: `(testedElementsCount + testedLinksCount) / (testedElementsCount + untestedElementsCount + testedLinksCount + untestedLinksCount)`, as a percent with one decimal (100 when there are none). Until links are tracked as their own units, the link counts are `0` and `<a>` elements count as elements.
- **Identity:** an element is `(view name, key)`; tests are referenced by `TestCase.id`.
- **Types:** `import type { CoverageReport } from 'playwright-ui-coverage'`. **JSON Schema:** `playwright-ui-coverage/coverage.schema.json` (`schema/coverage.schema.json` in the package).
- **Compatibility:** `schemaVersion` changes only on breaking changes. Fields may be added at any time, so ignore fields you don't know. `views[].screenshots` is marked `x-internal` (for the HTML report; not covered by the version).

```js
// A custom gate: fail when any view under /admin is below 60%.
const report = JSON.parse(fs.readFileSync('ui-coverage-report/coverage.json', 'utf8'));
if (report.schemaVersion !== 1) throw new Error(`unsupported coverage.json schemaVersion ${report.schemaVersion}`);
const low = report.views.filter((v) => v.name.startsWith('/admin') && v.summary.coverage < 60);
```

## Comparing runs, PR comments and the GitHub step summary

`compare` diffs two `coverage.json` files, e.g. the latest run on `main` and the pull request's run:

```bash
npx playwright-ui-coverage compare base/coverage.json ui-coverage-report/coverage.json [--format markdown|json] [--out file] [--report-url <url>] [--title <text>]
```

It reports the overall and per-view coverage delta, **new untested elements** (with why: `was tested`, `new element`, `new view`), **resolved** gaps (untested in base, tested now), added, removed and renamed views (matched by similar keys, like the baseline), and threshold checks whose status changed. Elements are matched by `(view, key)`.

The markdown is meant for a sticky PR comment: it starts with `<!-- playwright-ui-coverage -->` (so a workflow can find and update its comment), lists only changed views, collapses long lists in `<details>` and truncates them at 50 entries, and is deterministic (no timestamps, stable order). For example:

```md
<!-- playwright-ui-coverage -->
### UI coverage: 38.6% (-1.8 pp)

| | Coverage | Tested | Views |
|---|---:|---:|---:|
| Base | 40.4% | 23/57 | 5 |
| Head | **38.6%** | 22/57 | 5 |

**1 new untested element** · 0 resolved

**Views changed (1), 4 unchanged**

| View | Base | Head | Δ | New gaps | Resolved |
|---|---:|---:|---:|---:|---:|
| `/settings` | 30% (3/10) | 20% (2/10) | -10.0 pp | 1 | 0 |

**New untested elements (1)**

- `/settings` checkbox "Email notifications" (was tested) `#notify`
```

`--format json` writes the same data (`CoverageComparison` in [src/compare.ts](src/compare.ts), `comparisonVersion: 1`). `compare` always exits with 0 (2 on errors): gate with `threshold` or `baseline`. `--report-url` (where you publish the HTML report) turns view names into links.

**Step summary:** with `githubSummary: true`, the reporter (and the `report` CLI) appends a markdown summary to the file in `$GITHUB_STEP_SUMMARY`: coverage per view, failing thresholds and the baseline result. Off by default; outside GitHub Actions (variable not set) it does nothing. `npx playwright-ui-coverage summary [coverage.json]` prints the same markdown, e.g. for a PR comment when there's no base run to compare with.

A complete GitHub Actions workflow (download the base artifact from `main`, run the tests, compare, post or update a sticky comment): [docs/github-actions.md](docs/github-actions.md).

The functions are exported for your own tooling: `compareReports`, `comparisonMarkdown`, `reportMarkdown`, `checkBaseline`, `createBaseline`.

## Sharding and `merge-reports`

Coverage data and screenshots are stored as test attachments, so they travel with Playwright's `blob` reporter. Run each shard with the blob reporter, then merge on any machine with the UI coverage reporter:

```bash
# on each CI job
npx playwright test --shard=1/2 --reporter=blob
npx playwright test --shard=2/2 --reporter=blob

# after collecting every blob-report/*.zip into all-blob-reports/
npx playwright merge-reports --reporter playwright-ui-coverage/reporter all-blob-reports
```

The merged report is the same as one from an unsharded run. To pass reporter options (e.g. `outputFolder`, `threshold`, and the [report-time rules](#report-time-rules-reporter-options)), use a config file with `npx playwright merge-reports --config merge.config.ts all-blob-reports`. `--reporter` on the command line uses default options, so rules set in the reporter options would be missing:

```ts
// merge.config.ts
import rules from './ui-coverage.config.json';

export default {
  reporter: [['playwright-ui-coverage/reporter', { ...rules, outputFolder: 'ui-coverage-report', threshold: 30 }]],
};
```

Each screenshot is a file attachment named `ui-coverage-screenshot-<n>`, next to the `ui-coverage` JSON attachment, so you'll see them listed under the test's attachments in Playwright's own HTML report.

## Rebuilding the report (`report` CLI)

The reporter keeps the raw recordings next to the report:

```
ui-coverage-report/
  index.html, coverage.json, screens/   ← the report
  data/
    ui-coverage-data.json               ← every test attempt's raw recording
    screenshots/                        ← every screenshot, not just the ones the report shows
```

Rebuild the report from it, e.g. after changing a filter, without running the tests:

```bash
npx playwright-ui-coverage report --config ui-coverage.config.json
npx playwright-ui-coverage report --data ci-artifacts/ui-coverage-report/data --config ui-coverage.config.mjs --out ui-coverage-report
```

| Flag | Default | |
|---|---|---|
| `--config <file>` | none (default options) | A module exporting the reporter options: `.json`, `.js`/`.cjs` (`module.exports = {…}`), `.mjs` (`export default {…}`), or `.ts`/`.mts` if your Node.js can import TypeScript (22.18+ / 23.6+). Functions like `normalizeUrl` need a JS/TS config. |
| `--data <dir>` | `data/` in the config's `outputFolder` (else `ui-coverage-report/data`) | The data folder. |
| `--out <dir>` | the folder that contains `--data` | Where to write the report. Only `index.html`, `coverage.json` and `screens/` are replaced. |

`threshold` and `baseline` are checked like in the reporter: the CLI exits with code 1 if a threshold isn't met or there are new untested elements, and 2 on errors (bad flags, unreadable data, invalid rules). Other commands: [`baseline`](#baseline-fail-only-on-new-untested-elements), [`compare` and `summary`](#comparing-runs-pr-comments-and-the-github-step-summary).

**What a rebuild can change:** everything the reporter does with the data: [report-time rules](#report-time-rules-reporter-options), `normalizeUrl`, `viewBy`, `threshold`, `countFailedTests`, `maxScreenshotsPerRoute`. Links to the HTML report are kept and adjusted to `--out` (`htmlReport: false` drops them). **What it can't:** what was recorded. Which elements are interactive is decided in the browser (it needs the live page: computed styles, descendants, label targets), interaction types are recording options, and screenshots are what they are. The deprecated `use.uiCoverage.ignoreSelectors` was applied while recording.

**Data format.** `ui-coverage-data.json` has `formatVersion: 1` and an `attempts` array: one entry per test attempt and browser context with `testId`, `retry`, `passed`, `title`, `project`, `trace`, `tags`, `specFile` and `data`, the recording (`formatVersion: 2`, see `RawCoverageData` in [src/model/raw.ts](src/model/raw.ts)):

- `nodes`: a table of DOM elements, each `{ tag, parent?, nth?, of?, attrs? }`: the parent's index, the position among same-tag siblings (`:nth-of-type`), and the attributes. Ancestor chains are stored once and shared by every element under them.
- `snapshots`: `{ url, dpr, screenshot?, elements }`, with each element `{ node, name?, x, y, w, h }` (`name` is the accessible name, used for labels only; `candidateOnly: true` marks elements recorded although they aren't interactive, like `<label>`).
- `interactions`: `{ event, url, element: { node, name? } }`, pointing into the same node table, so an interaction resolves to the same key as the element in the inventory.
- `rules`: the deprecated `use.uiCoverage` identity rules, if any.

The same recording is the `ui-coverage` test attachment, so `merge-reports` and the data folder carry identical data. Attachments from earlier versions (no `formatVersion`, keys computed in the browser) are still read, but report-time rules can't change their keys.

## Component testing

Playwright component testing (`@playwright/experimental-ct-react`, `-vue`, `-svelte`, …) works in both recording modes. Every component test loads the same page (the CT dev server's index), so the report has **one view per spec file** instead of one per URL, named by the file's path relative to `testDir`:

```
UI coverage: 55.6% (5/9 elements)
  Counter.spec.tsx           33.3%  1/3
  forms/LoginForm.spec.tsx   66.7%  4/6
```

**Fixture mode:** merge `uiCoverage` into the CT `test`. The CT packages build their `test` on the same Playwright `test` as `@playwright/test`, so `mergeTests` combines them and `mount` keeps working:

```ts
// tests/fixtures.ts
import { test as ctTest, expect } from '@playwright/experimental-ct-react';
import { mergeTests } from '@playwright/test';
import { uiCoverage } from 'playwright-ui-coverage';

export const test = mergeTests(ctTest, uiCoverage);
export { expect };
```

**Register mode:** import `playwright-ui-coverage/register` from `playwright-ct.config.ts`, and keep importing `test` from the CT package. In an ES module config, use `await import('playwright-ui-coverage/register')` or a top-level `import`.

```ts
// playwright-ct.config.ts
import { defineConfig } from '@playwright/experimental-ct-react';
import 'playwright-ui-coverage/register';

export default defineConfig({
  reporter: [['list'], ['playwright-ui-coverage/reporter']],
});
```

Notes:

- **Install `@playwright/test` at the same version as your CT package.** `playwright-ui-coverage` imports `@playwright/test`, and the CT packages are released on their own schedule (e.g. `@playwright/experimental-ct-react@1.62.1` needs `@playwright/test@1.62.1`). With mismatched versions npm installs two copies of Playwright, and the library hooks into the copy your tests don't run on. Check with `npm ls playwright-core`: there should be one version.
- **Grouping:** the reporter's `viewBy` option is `'auto'` by default. It groups by file when the config comes from a CT `defineConfig`, or when the recorded data says it came from a component test (so `merge-reports` with a plain config groups by file too). Set `viewBy: 'file'` or `'url'` to choose yourself. With `'file'`, `normalizeUrl` isn't used, and `threshold.views` keys are file paths (`'components/**'` matches every spec under `components/`).
- CT reuses one browser context for the tests of a worker. Both modes record each test separately anyway.

[`examples/ct-react`](examples/ct-react) is a complete React example. Run it with `npm run example:ct` (fixture mode) or `npm run example:ct:register`.

## Compatibility

- **`@playwright/test` 1.50 or later.** CI runs the demo in both modes on Chromium, Firefox and WebKit with 1.50.0 and the latest release, and weekly against `@playwright/test@next`. Older versions still record coverage, but show an extra `attach "ui-coverage"` step in each test's report.

## Known limitations

- UI states that last shorter than `snapshotDelay` (e.g. a modal a test opens and closes instantly) still count their elements, but may not get a screenshot.
- Inventory covers the main frame only. Iframes and shadow DOM aren't inventoried yet.
- Hover-only interactions aren't counted.
- With `scroll` enabled, Playwright's automatic scrolling-into-view before actions also counts as a `scroll` of the container. That's why `scroll` is off by default.
- Elements with `position: fixed` may be offset in full-page screenshots.

## Development

```bash
npm install
npx playwright install chromium
npm run demo          # fixture mode: runs demo/tests, writes ui-coverage-report/
npm run demo:register # register mode: same tests, config-only recording
UICOV_DEMO_THRESHOLDS=1 npm run demo     # per-view thresholds that fail (exit code 1)
UICOV_DEMO_THRESHOLDS=pass npm run demo  # per-view thresholds that pass
UICOV_DEMO_FAIL=1 npx playwright test --retries=1  # adds a failing and a flaky test (demo/tests/failing.spec.ts)
UICOV_TRACE=1 npm run demo  # records traces; "Tested by" links to them in playwright-report/
npm run check:interactivity  # in-browser check of the interactivity rules and interaction types
npm run check:locators       # checks suggested locators and a11y hints; with a demo report, that every locator resolves
npm run example:ct    # component testing example (examples/ct-react): installs it, runs it, writes its report
npm run demo:sharded  # runs 2 blob shards + merge-reports, checks it matches an unsharded run
npm run check:rebuild # checks the report CLI rebuilds the same report from data/, and that changed rules apply
npm run check:baseline  # baseline update/check, a new gap (UICOV_DEMO_GAP=1), compare and the step summary, end to end
UICOV_DEMO_BASELINE=update npm run demo           # writes demo/ui-coverage-baseline.json (gitignored)
UICOV_DEMO_BASELINE=check UICOV_DEMO_GAP=1 npm run demo  # a test skips a step: fails with 1 new untested element
UICOV_DEMO_LEGACY=1 npm run demo  # sets the rules the deprecated way (use.uiCoverage); same report
npm run docs:screenshots  # regenerates the README images in docs/ (run demo first)
npm run perf          # builds a 300-route synthetic report in perf-report/ and times it in Chromium
npm run typecheck
npm run build         # compiles to dist/
npm test              # unit tests (vitest)
BROWSER=firefox scripts/demo-both-modes.sh  # what CI runs: both modes, same coverage, no extra steps
```

## License

MIT
