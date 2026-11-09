# playwright-ui-coverage

See which buttons, links and inputs your Playwright E2E tests **actually touch**: screenshots of every page with green (tested) and red (untested) overlays, a coverage % per page, and the tests that covered each element.

![UI coverage report: route list with coverage %, a screenshot of the /users page with green boxes on tested elements and red boxes on untested ones](docs/images/report-overview.png)

- **No test changes.** One import in `playwright.config.ts`, or a fixture you merge with `mergeTests`.
- **Find the gaps, close them fast.** Filter to untested elements, copy a ready-made Playwright locator for each, or a whole test skeleton per page.
- **Stable identity.** Elements are matched by attributes and position, never by text; repeated controls (a "Delete" on every row) count once; links count by the page they lead to.
- **CI gates.** Per-view thresholds, a baseline that fails only on *new* untested elements, and run-to-run comparison for sticky PR comments.
- **Change rules without re-running.** Filters, views and identity rules apply at report time; rebuild the report from stored data with one command.
- **Works where your tests run:** Chromium, Firefox, WebKit, iframes, shadow DOM, retries, sharding with `merge-reports`, and component tests. `coverage.json` is versioned, with a JSON Schema.

## Quick start

```bash
npm i -D playwright-ui-coverage
```

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import 'playwright-ui-coverage/register'; // records every test, no test changes

export default defineConfig({
  reporter: [['list'], ['playwright-ui-coverage/reporter']],
});
```

```bash
npx playwright test                 # prints "UI coverage: 58.8% (60/102: …)" and a line per page
open ui-coverage-report/index.html
```

Register mode relies on a private Playwright hook. For long-term use, merge the stable fixture instead: `export const test = mergeTests(appTest, uiCoverage)` with `uiCoverage` from `playwright-ui-coverage`. Both are covered in [Getting started](docs/guide/getting-started.md).

## Documentation

**https://indigolain.github.io/playwright-ui-coverage/**: guides, CI setup, and the full configuration, CLI and `coverage.json` reference.

## Status

Early development (0.1.0): APIs may change. Requires `@playwright/test` 1.50 or later; CI covers Chromium, Firefox and WebKit on 1.50.0 and the latest release. See [Compatibility](docs/reference/compatibility.md) and [Known limitations](docs/reference/limitations.md). Working on the library: [Contributing](docs/reference/contributing.md).

## License

MIT
