# Reporter options

This page lists the settings the reporter (and the [`report` CLI](./cli.md#report)) applies when it builds the report. They are top-level keys of the [config file](./configuration.md), or inline reporter options:

```ts
// playwright.config.ts
reporter: [
  ['playwright-ui-coverage/reporter', { outputFolder: 'ui-coverage-report', threshold: 80 }],
],
```

Prefer the config file: the CLI reads only the file, so settings you want to [rebuild](../guide/how-it-works.md#rebuilding-the-report) with belong there. All of these are applied at report time.

## Options

| Option | Default | Description |
|---|---|---|
| `outputFolder` | `ui-coverage-report` | Report location (relative to the config file). |
| `views`, `viewFilters` | automatic | URL patterns that name views, and URLs to leave out. Link destinations go through them too. See [Views](../guide/views.md). |
| `normalizeUrl` | automatic rules | `(url) => viewName`, for URLs no `views` pattern matches. See [Views](../guide/views.md). |
| `maxScreenshotsPerRoute` | `3` | Screenshots per view, chosen to cover the most elements. |
| `threshold` | none | Fail the run if coverage % is below this: a number (overall), or `{ overall, views }` for per-view minimums. See [Thresholds](../ci/thresholds.md). |
| `countFailedTests` | `false` | Let interactions from tests that didn't pass mark elements as tested. See [Retries and failed tests](../guide/retries.md). |
| `testIdAttribute` | from config | Attribute for `getByTestId()` in suggested locators. Default: the `use.testIdAttribute` of the first project that sets one, else `data-testid`. See [Suggested locators](../guide/locators-and-accessibility.md#suggested-locators). |
| `viewBy` | `'auto'` | Group views by page URL (`'url'`) or by spec file (`'file'`). `'auto'` picks `'file'` for component tests. See [Component testing](../guide/component-testing.md). |
| `htmlReport` | detected | Folder of Playwright's HTML report (relative to the config file) that "Tested by" links to. Detected from the `html` reporter in the config; `false` turns the links off. See [Insights and the HTML report](../guide/insights.md#links-to-the-html-report-and-traces). |
| `saveData` | `true` | Keep the raw data and every screenshot in `<outputFolder>/data/` for the [`report` CLI](./cli.md#report). |
| `baseline` | none | Fail only on *new* untested elements, compared with a committed baseline file. See [Baseline](../ci/baseline.md). |
| `githubSummary` | `false` | Append a markdown summary to `$GITHUB_STEP_SUMMARY` when it's set. See [Comparing runs](../ci/compare.md#step-summary). |
| `elementFilters`, `elements`, `significantAttributes`, `attributeFilters` (deprecated: `ignoreSelectors`) | `[]` | [Report-time rules](../guide/rules.md). |
| `elementGroups`, `autoGroup` | `[]`, all on | [Element grouping](../guide/element-grouping.md). |
| `links` | `{}` | How `<a href>` counts: link units by destination view. `{ external: 'ignore' }` drops links to other sites; `false`: every link is an element. See [Links and untested views](../guide/links.md). |

## Reporter options only

These can't be set in the config file:

| Option | Description |
|---|---|
| `configFile` | Path to the config file, relative to the Playwright config; `false`: no file. `UI_COVERAGE_CONFIG` wins over it. See [Where the config comes from](./configuration.md#where-the-config-comes-from). |
| `profile` | The [profile](./configuration.md#profiles) to use. `UI_COVERAGE_PROFILE` wins over it. |

`recording` can't be set in the reporter options: the recorder runs in the test workers and can't see them, so that's an error. Put it in the config file.

## Output

The reporter writes to `outputFolder`:

| Path | Contents |
|---|---|
| `index.html` | The [HTML report](../guide/reading-the-report.md). |
| `coverage.json` | The machine-readable results, see [coverage.json](../coverage-json.md). |
| `screens/` | The screenshots the report shows. |
| `data/` | Raw recordings and every screenshot (unless `saveData: false`), see [Raw data format](./raw-data.md). |

It also prints a summary to the console, and the run fails (exit code 1) when a [threshold](../ci/thresholds.md) isn't met or the [baseline](../ci/baseline.md) check finds new gaps.
