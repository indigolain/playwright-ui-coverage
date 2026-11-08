# Retries and failed tests

This page explains which test attempts count when Playwright retries tests, and how elements touched only by failing tests are shown.

Playwright runs a test again on retry, and every attempt records coverage. The reporter combines the attempts of each test like this:

- **Element totals** use inventories from every attempt, passed or failed. A page a failing test reached still adds its elements to the total.
- **Tested** comes from passing attempts only (by default). An attempt passes when its status is the one the test expects: `passed`, or `failed` for a `test.fail()` test. Skipped, timed-out and interrupted attempts don't pass.
- **Retries:** if any attempt of a test passed, only the last passing attempt's interactions count. For a flaky test (fails, then passes on retry) that is the retry that passed. The earlier failed attempts add element totals only.
- **Tests that never passed:** their interactions don't count as tested. Elements that only such tests touched are shown as **failing tests only** (amber) in the report. They count as untested in the percentage. In `coverage.json` these elements have `tested: false` and a non-empty `failingTestIds`, and each view and the summary have a `failingOnlyElementsCount`.
- **No duplicates:** a test is listed once under "Tested by", however many attempts it took.

The same "counted test" rule decides whether a [link](./links.md) is tested: a counted attempt must have visited the destination view.

## Counting failed tests

With `countFailedTests: true`, interactions from every attempt count as tested, whether it passed or not:

```ts
// ui-coverage.config.ts
import { defineUiCoverageConfig } from 'playwright-ui-coverage/config';

export default defineUiCoverageConfig({
  countFailedTests: true, // default: false
});
```

`countFailedTests` is applied at report time, so a [rebuild](./how-it-works.md#rebuilding-the-report) can switch it.

## Links to the HTML report

When "Tested by" links to Playwright's HTML report, a flaky test links to the retry that passed, and a test that never passed to its last attempt. See [Insights and the HTML report](./insights.md#links-to-the-html-report-and-traces).
