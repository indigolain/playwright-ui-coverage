# playwright-ui-coverage

See which buttons, links and inputs your Playwright E2E tests **actually touch**, as screenshots with green (tested) and red (untested) overlays, a coverage % per page, and the tests that covered each element.

> Status: early development (0.1.0). APIs may change.

## Quick start

```bash
npm i -D playwright-ui-coverage
```

**1. Use the instrumented `test`** in place of `@playwright/test`'s:

```ts
import { test, expect } from 'playwright-ui-coverage';

test('subscribe', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByRole('button', { name: 'Subscribe' }).click();
});
```

**2. Add the reporter** in `playwright.config.ts`:

```ts
export default defineConfig({
  reporter: [
    ['list'],
    ['playwright-ui-coverage/reporter', { outputFolder: 'ui-coverage-report' }],
  ],
});
```

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
2. **Inventory + screenshot**: when a page loads and shortly after interactions, the fixture lists every visible interactive element (with bounding boxes) and takes a full-page screenshot. It only takes a new screenshot when new elements appear.
3. **Reporter**: merges data from all workers, groups by route (`/users/42` → `/users/:id`), marks an element *tested* if any test interacted with it, and renders the HTML report and `coverage.json`.

### Element identity

Elements are matched across tests by, in order:
`data-testid` → stable `id` → role + accessible name (e.g. `button "Save"`).
Adding `data-testid`s makes matching the most reliable.

## Options

### Fixture (`use.uiCoverage`)

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
npm run demo          # runs demo/tests against the demo app, writes ui-coverage-report/
npm run typecheck
npm run build         # compiles to dist/
```

## License

MIT
