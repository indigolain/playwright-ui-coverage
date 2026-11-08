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
UI coverage: 33.3% (12/36 elements)
  /            42.9%  3/7
  /settings    22.2%  2/9
  /users       42.9%  6/14
  /users/:id   16.7%  1/6
```

## How it works

1. **Tracker** (`addInitScript`): a capture-phase listener records every `click` / `input` / `change` / `submit` on an interactive element, whichever Playwright API (or a real user) caused it.
2. **Inventory + screenshot**: when a page loads and shortly after interactions, the recorder lists every visible interactive element (with bounding boxes) and takes a full-page screenshot. It only takes a new screenshot when new elements appear.
3. **Reporter**: merges data from all workers, groups by route (`/users/42` → `/users/:id`), marks an element *tested* if any test interacted with it, and renders the HTML report and `coverage.json`.

### Element identity

Elements are matched across tests by, in order:
`data-testid` → stable `id` → role + accessible name (e.g. `button "Save"`).
Adding `data-testid`s makes matching the most reliable.

## Options

### Recording (`use.uiCoverage`, works in both modes)

```ts
use: {
  uiCoverage: {
    enabled: !!process.env.UI_COVERAGE, // default: true
    ignoreSelectors: ['.cookie-banner'], // default: []
    snapshotDelay: 250,                  // ms, default: 250
  },
},
```

Anything inside an element with `data-uicov-ignore` is always excluded.

### Reporter

| Option | Default | Description |
|---|---|---|
| `outputFolder` | `ui-coverage-report` | Report location (relative to the config file). |
| `normalizeUrl` | strips query, ids → `:id` | `(url) => routeName`, to group pages your own way. |
| `maxScreenshotsPerRoute` | `3` | Screenshots chosen to cover the most elements. |
| `threshold` | none | Fail the run if overall coverage % is below this. |

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
npm run docs:screenshots  # regenerates the README images in docs/ (run demo first)
npm run typecheck
npm run build         # compiles to dist/
```

## License

MIT
