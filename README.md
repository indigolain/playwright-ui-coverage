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

This is the quickest way to try it on an existing suite. It hooks into Playwright's internal instrumentation, the same hook Playwright's trace recorder uses. That API is private, so if a Playwright release changes it, register mode switches itself off with a warning. Option B keeps working either way.

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

1. **Tracker** (`addInitScript`): a capture-phase listener records every `click` / `input` / `change` / `submit` on an interactive element, whichever Playwright API (or a real user) caused it.
2. **Inventory + screenshot**: when a page loads and shortly after interactions, the recorder lists every visible interactive element (with bounding boxes) and takes a full-page screenshot. It only takes a new screenshot when new elements appear.
3. **Reporter**: merges data from all workers, groups by route (`/users/42` → `/users/:id`), marks an element *tested* if any test interacted with it, and renders the HTML report and `coverage.json`.

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
import type { UiCoverageOptions } from 'playwright-ui-coverage';

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
    },
  },
});
```

Anything inside an element with `data-uicov-ignore` is always excluded.

- **`significantAttributes`**: attributes that identify an element, checked after `data-uicov-id` and before the built-in test-id attributes, in the order given.
- **`attributeFilters`**: `{ attribute, value?, include? }` rules deciding whether an attribute value may be used as a key. `attribute` and `value` are regular expressions, anchored automatically (`'id'` means `^(?:id)$`). Attribute names match case-insensitively, values case-sensitively. Without `value`, the rule matches any value. The first matching rule wins: `include: false` (default) skips the value, `include: true` keeps it. Your rules run before the built-in ones, which skip:
  - React `useId` values (`:r1:`, `:R2kq:`, `«r1»`), UUIDs and hex strings of 16+ characters, in any attribute;
  - in `id` and `name`: framework counters (`ember123`, `mui-12345`, `radix-…`, `headlessui-…`, `react-aria-…`, `downshift-…`, `react-select-…`, `mat-…-0`, `cdk-…-3`, `ui-id-4`, `ext-gen12`, `gwt-uid-3`, `yui_…`, `j_id…`), purely numeric values and values with 3+ consecutive digits.

  The built-in lists are exported as `BUILTIN_IDENTITY_ATTRIBUTES` and `BUILTIN_ATTRIBUTE_FILTERS`.

Each recorded element also keeps its raw identifying attributes (`attrs`: `id`, `name`, `role`, `type`, `aria-label`, `href`, `data-*` and your `significantAttributes`) in the test attachment.

### Reporter

| Option | Default | Description |
|---|---|---|
| `outputFolder` | `ui-coverage-report` | Report location (relative to the config file). |
| `normalizeUrl` | strips query, ids → `:id` | `(url) => routeName`, to group pages your own way. |
| `maxScreenshotsPerRoute` | `3` | Screenshots chosen to cover the most elements. |
| `threshold` | none | Fail the run if overall coverage % is below this. |
| `countFailedTests` | `false` | Let interactions from tests that didn't pass mark elements as tested. See below. |

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

## Known limitations

- UI states that last shorter than `snapshotDelay` (e.g. a modal a test opens and closes instantly) still count their elements, but may not get a screenshot.
- Inventory covers the main frame only. Iframes and shadow DOM aren't inventoried yet.
- Hover-only interactions aren't counted.
- Elements with `position: fixed` may be offset in full-page screenshots.

## Development

```bash
npm install
npx playwright install chromium
npm run demo          # fixture mode: runs demo/tests, writes ui-coverage-report/
npm run demo:register # register mode: same tests, config-only recording
UICOV_DEMO_FAIL=1 npx playwright test --retries=1  # adds a failing and a flaky test (demo/tests/failing.spec.ts)
npm run demo:sharded  # runs 2 blob shards + merge-reports, checks it matches an unsharded run
npm run docs:screenshots  # regenerates the README images in docs/ (run demo first)
npm run typecheck
npm run build         # compiles to dist/
```

## License

MIT
