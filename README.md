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

**Large suites.** Filter routes by name (press `/`), sort them by name, lowest coverage or most untested elements, and screenshots load lazily. A synthetic report with 300 routes × 80 elements opens in under 0.1 s and switching routes takes a few milliseconds (`npm run perf` to measure).

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
UI coverage: 38.9% (14/36 elements)
  /              50%  4/8
  /settings      30%  3/10
  /users         50%  6/12
  /users/:id   16.7%  1/6
```

## How it works

1. **Tracker** (`addInitScript`): capture-phase listeners record every interaction (`click`, `input`, `change`, `submit`, `dblclick`, `contextmenu`, keyboard activation, drag and drop, opt-in `scroll`/`focus`/`blur`, see [Interaction types](#interaction-types)) on an [interactive element](#which-elements-count), whichever Playwright API (or a real user) caused it.
2. **Inventory + screenshot**: when a page loads and shortly after interactions, the recorder lists every visible interactive element (with bounding boxes) and takes a full-page screenshot. It only takes a new screenshot when new elements appear.
3. **Reporter**: merges data from all workers, groups by route (`/users/42` → `/users/:id`), marks an element *tested* if any test interacted with it, and renders the HTML report and `coverage.json`.

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

Attribute values that look generated (rules 2–5) are skipped, see `attributeFilters` below. Visible text (role + accessible name, e.g. `button "Save"`) is shown in the report as the element's **label** only.

Positional keys read like CSS selectors and only use an index when there are several siblings with the same tag. Table rows (`<tr>`, `role="row"`) never get an index, so a "Delete" button on every row is one element with several instances. Positional keys change when the markup around the element changes, so for anything that matters, add a `data-testid` (or a `data-uicov-id`).

## Options

### Recording (`use.uiCoverage`, works in both modes)

```ts
import { defineConfig } from '@playwright/test';
import { DEFAULT_INTERACTIONS, type UiCoverageOptions } from 'playwright-ui-coverage';

export default defineConfig<{ uiCoverage: Partial<UiCoverageOptions> }>({
  use: {
    uiCoverage: {
      enabled: !!process.env.UI_COVERAGE, // default: true
      ignoreSelectors: ['.cookie-banner'], // default: []
      snapshotDelay: 250,                  // ms, default: 250
      significantAttributes: ['data-component'], // default: []
      attributeFilters: [                  // default: []
        { attribute: 'id', value: 'tmp-.*' },               // ignore id="tmp-…"
        { attribute: 'id', value: 'mui-legacy', include: true }, // keep, despite the built-in rule
      ],
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

Anything inside an element with `data-uicov-ignore` (or `data-uicov-interactive="exclude-all"`) is excluded, see [Which elements count](#which-elements-count).

- **`significantAttributes`**: attributes that identify an element, checked after `data-uicov-id` and before the built-in test-id attributes, in the order given.
- **`attributeFilters`**: `{ attribute, value?, include? }` rules deciding whether an attribute value may be used as a key. `attribute` and `value` are regular expressions, anchored automatically (`'id'` means `^(?:id)$`). Attribute names match case-insensitively, values case-sensitively. Without `value`, the rule matches any value. The first matching rule wins: `include: false` (default) skips the value, `include: true` keeps it. Your rules run before the built-in ones, which skip:
  - React `useId` values (`:r1:`, `:R2kq:`, `«r1»`), UUIDs and hex strings of 16+ characters, in any attribute;
  - in `id` and `name`: framework counters (`ember123`, `mui-12345`, `radix-…`, `headlessui-…`, `react-aria-…`, `downshift-…`, `react-select-…`, `mat-…-0`, `cdk-…-3`, `ui-id-4`, `ext-gen12`, `gwt-uid-3`, `yui_…`, `j_id…`), purely numeric values and values with 3+ consecutive digits.

  The built-in lists are exported as `BUILTIN_IDENTITY_ATTRIBUTES` and `BUILTIN_ATTRIBUTE_FILTERS`.

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

Each recorded element also keeps its raw identifying attributes (`attrs`: `id`, `name`, `role`, `type`, `aria-label`, `href`, `data-*` and your `significantAttributes`) in the test attachment.

Screenshot options:

| Option | Default | Description |
|---|---|---|
| `screenshots` | `'on'` | `'on'`: screenshot whenever a page state shows elements no screenshot has shown yet. `'first-only'`: at most one screenshot per URL per test. `'off'`: no screenshots; the report shows the element tables only. Elements are counted in every mode. |
| `format` | `'png'` | `'jpeg'` files are usually several times smaller. |
| `quality` | `80` | JPEG quality (ignored for PNG). |
| `maxScreenshotHeight` | `8000` | Full-page screenshots of taller pages are cropped to this height. Elements below the crop are still counted, just not drawn on the image. `0` disables the cap. |

In `coverage.json`, each element has `interactionCounts`: the interactions that counted as tested, by type (`{ "click": 3, "input": 1 }`). The report shows them as the tooltip of the *tested* label.

### Reporter

| Option | Default | Description |
|---|---|---|
| `outputFolder` | `ui-coverage-report` | Report location (relative to the config file). |
| `normalizeUrl` | strips query, ids → `:id` | `(url) => routeName`, to group pages your own way. |
| `maxScreenshotsPerRoute` | `3` | Screenshots chosen to cover the most elements. |
| `threshold` | none | Fail the run if coverage % is below this: a number (overall), or `{ overall, views }` for per-view minimums. See below. |
| `countFailedTests` | `false` | Let interactions from tests that didn't pass mark elements as tested. See below. |
| `viewBy` | `'auto'` | Group views by page URL (`'url'`) or by spec file (`'file'`). `'auto'` picks `'file'` for component tests. See [Component testing](#component-testing). |

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

When `threshold` is set, `coverage.json` gets a `thresholds` array for CI tooling:

```json
{ "target": "/users/:id", "pattern": "/users/*", "required": 20, "actual": 16.7, "passed": false, "status": "failed" }
```

`target` is `overall` or a view name. `status` is `passed`, `failed` or `missing` (then `actual` is `null` and `passed` is `true`).

### Retries and failed tests

Playwright runs a test again on retry, and every attempt records coverage. The reporter combines the attempts of each test like this:

- **Element totals** use inventories from every attempt, passed or failed. A page a failing test reached still adds its elements to the total.
- **Tested** comes from passing attempts only (by default). An attempt passes when its status is the one the test expects: `passed`, or `failed` for a `test.fail()` test. Skipped, timed-out and interrupted attempts don't pass.
- **Retries:** if any attempt of a test passed, only the last passing attempt's interactions count. For a flaky test (fails, then passes on retry) that is the retry that passed. The earlier failed attempts add element totals only.
- **Tests that never passed:** their interactions don't count as tested. Elements that only such tests touched are shown as **failing tests only** (amber) in the report. They count as untested in the percentage. In `coverage.json` these elements have `tested: false` and a non-empty `testedByFailing`, and each route and the summary have a `failingOnly` count.
- **No duplicates:** a test is listed once under "Tested by", however many attempts it took.

With `countFailedTests: true`, interactions from every attempt count as tested, whether it passed or not.

## Sharding and `merge-reports`

Coverage data and screenshots are stored as test attachments, so they travel with Playwright's `blob` reporter. Run each shard with the blob reporter, then merge on any machine with the UI coverage reporter:

```bash
# on each CI job
npx playwright test --shard=1/2 --reporter=blob
npx playwright test --shard=2/2 --reporter=blob

# after collecting every blob-report/*.zip into all-blob-reports/
npx playwright merge-reports --reporter playwright-ui-coverage/reporter all-blob-reports
```

The merged report is the same as one from an unsharded run. To pass reporter options (e.g. `outputFolder`, `threshold`), use a config file with `npx playwright merge-reports --config merge.config.ts all-blob-reports`:

```ts
// merge.config.ts
export default {
  reporter: [['playwright-ui-coverage/reporter', { outputFolder: 'ui-coverage-report', threshold: 30 }]],
};
```

Each screenshot is a file attachment named `ui-coverage-screenshot-<n>`, next to the `ui-coverage` JSON attachment, so you'll see them listed under the test's attachments in Playwright's own HTML report.

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
npm run check:interactivity  # in-browser check of the interactivity rules and interaction types
npm run example:ct    # component testing example (examples/ct-react): installs it, runs it, writes its report
npm run demo:sharded  # runs 2 blob shards + merge-reports, checks it matches an unsharded run
npm run docs:screenshots  # regenerates the README images in docs/ (run demo first)
npm run perf          # builds a 300-route synthetic report in perf-report/ and times it in Chromium
npm run typecheck
npm run build         # compiles to dist/
npm test              # unit tests (vitest)
BROWSER=firefox scripts/demo-both-modes.sh  # what CI runs: both modes, same coverage, no extra steps
```

## License

MIT
