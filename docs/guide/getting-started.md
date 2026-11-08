# Getting started

This page takes you from installing the package to opening your first UI coverage report. It takes a few minutes and needs no changes to your tests.

## Install

```bash
npm i -D playwright-ui-coverage
```

You need `@playwright/test` 1.50 or later (see [Compatibility](../reference/compatibility.md)).

## Turn recording on

There are two ways to record. Both use the same reporter and produce the same results, so you can start with one and switch later.

| | Register mode | Fixture mode |
|---|---|---|
| Setup | one import in `playwright.config.ts` | merge `uiCoverage` into your `test` with `mergeTests` |
| Test changes | none | your specs import `test` from your fixtures file |
| Stability | experimental: relies on a private Playwright API | stable, recommended for long-term use |

### Option A: register mode (config only)

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import 'playwright-ui-coverage/register'; // records every browser context in every test

export default defineConfig({
  reporter: [
    ['list'],
    ['playwright-ui-coverage/reporter'],
  ],
});
```

This is the quickest way to try it on an existing suite. It hooks into Playwright's internal instrumentation, the same hook Playwright's trace recorder uses. That API is private, so if a Playwright release changes it, register mode switches itself off with a warning. Set `UICOV_STRICT=1` to make that an error instead, for example in CI. Fixture mode keeps working either way.

In an ES module config, a top-level `import 'playwright-ui-coverage/register'` works, as does `await import('playwright-ui-coverage/register')`.

### Option B: fixture mode (stable)

Merge `uiCoverage` into your own fixtures with Playwright's `mergeTests`:

```ts
// tests/fixtures.ts
import { mergeTests } from '@playwright/test';
import { uiCoverage } from 'playwright-ui-coverage';
import { test as appTest } from './my-fixtures';

export const test = mergeTests(appTest, uiCoverage);
export { expect } from '@playwright/test';
```

No fixtures of your own? Import `test` directly instead:

```ts
import { test, expect } from 'playwright-ui-coverage';
```

Then add the reporter to `playwright.config.ts`, the same way as in Option A:

```ts
// playwright.config.ts
reporter: [['list'], ['playwright-ui-coverage/reporter']],
```

Either way, recording covers every page and popup in the test's browser context. It adds **no steps** to your HTML report or trace, because its calls are marked as internal.

## Run your tests and open the report

```bash
npx playwright test
open ui-coverage-report/index.html   # or xdg-open / start on Linux / Windows
```

The reporter also prints a summary. For the demo app in this repository it looks like this:

```
UI coverage: 58.8% (60/102: 39/80 elements, 21/22 links)
  /              75%  6/8
  /embedded    62.5%  10/16
  /long        41.2%  7/17
  /settings    45.5%  5/11
  /shop        69.2%  9/13
  /users       66.7%  8/12
  /users/:id     30%  3/10
  /widgets       80%  12/15
  1 untested view(s), only linked to: /settings/audit
  9 accessibility hint(s), informational (see the report)
  Report: ui-coverage-report/index.html
```

Coverage counts **units**: interactive elements plus [links](./links.md), grouped by the view they lead to. In the demo, every view but `/settings/audit` is visited by some test, so 21 of the 22 link units are tested; the "View audit log" link on `/settings` is the untested one, and `/settings/audit` is listed as an untested view.

Next: [Reading the report](./reading-the-report.md) explains what you see.

## Add a config file (optional)

All settings live in one file next to `playwright.config.ts`. The reporter, the recorder (in both modes) and the CLI read it, so the reporter needs no options:

```ts
// ui-coverage.config.ts
import { defineUiCoverageConfig } from 'playwright-ui-coverage/config';

export default defineUiCoverageConfig({
  elementFilters: [{ selector: '.cookie-banner *', include: false }], // don't count the cookie banner
  views: ['/users/:username'],                                       // name views by URL pattern
  threshold: { overall: 60 },                                         // fail the run below 60%
});
```

See [Configuration file](../reference/configuration.md) for every key.

## Try the demo

The repository has a small demo app with tests that exercise most features. From a clone:

```bash
npm install
npx playwright install chromium
npm run demo           # fixture mode: runs demo/tests, writes ui-coverage-report/
npm run demo:register  # register mode: same tests, config-only recording
```

Then open `ui-coverage-report/index.html`. More scripts are listed in [Contributing](../reference/contributing.md).

## Where to go next

- [How it works](./how-it-works.md): what is recorded and what is decided when the report is built.
- [Report-time rules](./rules.md) and [Views](./views.md): decide what counts and how pages are grouped.
- [Thresholds](../ci/thresholds.md) and [Baseline](../ci/baseline.md): use it as a CI gate.
