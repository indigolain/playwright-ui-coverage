# `coverage.json` reference (schema version 1)

The reporter and the `playwright-ui-coverage report` CLI write `coverage.json` next to `index.html` in the report folder (`ui-coverage-report/` by default). It's the integration point for CI gates, dashboards, baselines and PR comments.

- **TypeScript types:** `import type { CoverageReport } from 'playwright-ui-coverage'` (source: [src/coverage-report.ts](../src/coverage-report.ts)).
- **JSON Schema** (draft 2020-12): [schema/coverage.schema.json](../schema/coverage.schema.json), shipped in the package and importable as `playwright-ui-coverage/coverage.schema.json`.
- The raw data folder (`data/ui-coverage-data.json`, `formatVersion`) is a different file: input for rebuilding the report, not part of this contract.

## Compatibility

- `schemaVersion` is an integer, currently `1`. It changes only on **breaking** changes: a field removed or renamed, its type changed, or its meaning changed.
- **New fields can be added in any release without a version change.** Readers must ignore fields they don't know. The JSON Schema doesn't set `additionalProperties: false` for that reason.
- Fields marked **internal** (`"x-internal": true` in the schema) are written for the HTML report and may change in any release. In v1 that's `views[].screenshots`.
- Some values are heuristics whose *content* may change between releases while the field stays: `suggestedLocator` text, `a11yHints[].message` wording, the set of `a11yHints[].rule` ids, element `label`s.
- Check the version before reading:

  ```js
  if (report.schemaVersion !== 1) throw new Error(`unsupported coverage.json schemaVersion ${report.schemaVersion}`);
  ```

## What is counted (the denominator)

Coverage is measured in **units**: interactive elements and links.

```
coverage = (testedElementsCount + testedLinksCount)
         / (testedElementsCount + untestedElementsCount + testedLinksCount + untestedLinksCount) × 100
```

rounded to one decimal; `100` when there are no units.

- An **element** is an interactive element of a view (see "Which elements count" in the README), identified by its `key` within the view. Elements sharing a key (a "Delete" button on every row) are one unit, whatever `instances` says.
- An element is **tested** when a counted test interacted with it in that view. By default only each test's last passing attempt counts (`countFailedTests: true` counts every attempt). Elements touched only by attempts that didn't pass are untested and also counted in `failingOnlyElementsCount`.
- **Links:** `testedLinksCount` / `untestedLinksCount` are reserved for link tracking, where a link is a unit tested when its destination view was visited. Until then both are `0` and `<a>` elements are counted as ordinary elements. When link tracking arrives, links get their own counts (and `<a>` elements stop being counted as elements) without a schema version change, since the formula above already includes them.
- `a11yHintsCount` is informational and never affects `coverage`.
- The overall summary sums the views' counts; `coverage` is computed from the sums (not an average of the views' percents).

## Top level: `CoverageReport`

| Field | Type | |
|---|---|---|
| `schemaVersion` | `1` | See [Compatibility](#compatibility). |
| `generatedAt` | string | ISO 8601 time the report was built. |
| `generator` | `{ name, version }` | `name` is `"playwright-ui-coverage"`, `version` the package version that wrote the file. |
| `summary` | [`ReportSummary`](#summary-reportsummary--coveragecounts) | Overall counts. |
| `views` | [`ViewCoverage`](#views-viewcoverage)`[]` | One per view, sorted by name. |
| `tests` | [`TestRef`](#tests-testref)`[]` | Every test with recorded data, sorted by title. |
| `thresholds` | [`ThresholdCheck`](#thresholds-thresholdcheck)`[]` | Results of the `threshold` option; empty when it isn't set. |
| `insights` | `{ mostRepeated }` | See [Insights](#insights). |
| `playwrightReport` | `{ path, attachmentsBaseURL }`, optional | Playwright's HTML report, when linked: `path` is its folder relative to the folder of `coverage.json` (`/` separators), `attachmentsBaseURL` where `tests[].trace` files are, relative to `path`. |
| `config` | object, optional | **Reserved** for the effective report configuration. Treat its contents as informational. |

## `summary`: `ReportSummary` / `CoverageCounts`

`views[].summary` is a `CoverageCounts`; the top-level `summary` is a `ReportSummary`, the same plus `viewCount`.

| Field | Type | |
|---|---|---|
| `viewCount` | integer | Top level only: number of entries in `views`. |
| `coverage` | number | Percent, 0–100, one decimal. See [the denominator](#what-is-counted-the-denominator). |
| `testedElementsCount` | integer | |
| `untestedElementsCount` | integer | Includes `failingOnlyElementsCount`. |
| `testedLinksCount` | integer | `0` until link tracking. |
| `untestedLinksCount` | integer | `0` until link tracking. |
| `failingOnlyElementsCount` | integer | Untested elements that only attempts that didn't pass touched. |
| `a11yHintsCount` | integer | Accessibility hints on these elements. |

## `views[]`: `ViewCoverage`

A view is a page URL normalized by `normalizeUrl` (`/users/42?tab=x` → `/users/:id`), or, with `viewBy: 'file'` (component tests), a spec file path.

| Field | Type | |
|---|---|---|
| `name` | string | As shown in the report and matched by `threshold.views`. |
| `reportUrl` | string | This view in the HTML report, relative to the folder of `coverage.json`: `index.html#` + `encodeURIComponent(name)`. |
| `summary` | `CoverageCounts` | |
| `elements` | [`ElementCoverage`](#viewselements-elementcoverage)`[]` | Untested first, then by label. |
| `screenshots` | `ViewScreenshot[]` | **Internal.** The screenshots the HTML report shows: `{ file, dpr, testId?, boxes: [{ key, x, y, w, h }] }`, `file` relative to the folder of `coverage.json`, boxes in CSS pixels. Which screenshots are picked depends on timing. |

## `views[].elements[]`: `ElementCoverage`

`(view name, key)` identifies an element across runs, as long as the identity rules (`significantAttributes`, `attributeFilters`, …) don't change. This is the identity to use for baselines and run-to-run comparisons.

| Field | Type | |
|---|---|---|
| `key` | string | Structural selector, unique within the view. Inside an iframe or open shadow root, prefixed by the host's key and ` >> ` (`iframe[data-testid="payments"] >> [data-testid="card"]`, `promo-banner >> button:nth-of-type(2)`). |
| `label` | string | `role "name"`, with ` (+N variants)` when instances sharing the key had different labels. For display. |
| `tag` | string | Lowercase tag name; `?` for an element only seen in an interaction, never in an inventory. |
| `instances` | integer | Max number of instances seen at once. |
| `tested` | boolean | |
| `testIds` | string[] | Ids (into `tests`) of the tests whose interactions counted. Empty when untested. |
| `failingTestIds` | string[] | Ids of tests that touched it only in attempts that didn't pass. Non-empty with `tested: false` = "failing tests only". |
| `interactionCounts` | `Record<string, integer>` | Counted interactions by type, e.g. `{ "click": 3, "input": 1 }`. Empty when untested. Sum it for a total. |
| `role` | string, optional | Recorded ARIA role. |
| `name` | string, optional | Recorded accessible name. |
| `nameFrom` | string, optional | Where `name` came from: `aria-labelledby`, `aria-label`, `label`, `placeholder`, `title`, `alt`, `value`, `text` or `name`. |
| `attrs` | `Record<string, string>`, optional | Identifying attributes (`id`, `name`, `role`, `type`, `aria-label`, `href`, `tabindex`, `contenteditable`, `data-*`, your `significantAttributes`). |
| `frames` | string[], optional | Keys of the `<iframe>` elements the element is inside, outermost first; each is a prefix of `key`. Absent in the top document. |
| `suggestedLocator` | string, optional | One line of Playwright code that interacts with the element. Heuristic. |
| `a11yHints` | `{ rule, message }[]`, optional | Absent when there are none. `rule` is one of `no-name`, `placeholder-only`, `duplicate-name`, `not-focusable`, `no-role`; more may be added. |

Optional fields are absent (not `null`) when unknown, e.g. for data recorded by older versions.

## `tests[]`: `TestRef`

| Field | Type | |
|---|---|---|
| `id` | string | `TestCase.id`: stable across runs for the same file, title and project. |
| `title` | string | Spec file and title path: `users.spec.ts › add a user`. |
| `project` | string, optional | Playwright project name. |
| `passed` | boolean | Whether the attempt the report used passed (had the expected status, so `test.fail()` tests pass when they fail). |
| `retry` | integer | `TestResult.retry` of that attempt: the last passing one, else the last one. |
| `trace` | string, optional | That attempt's trace file in the HTML report's attachments folder, when linked: `<playwrightReport.path>/<attachmentsBaseURL><trace>`. |

## `thresholds[]`: `ThresholdCheck`

| Field | Type | |
|---|---|---|
| `scope` | `"overall"` \| `"view"` | |
| `view` | string, when `scope` is `view` | The view name; for a pattern that matched no view, the pattern. |
| `pattern` | string, optional | The `threshold.views` glob that set this requirement. |
| `required` | number | Required `coverage`. |
| `actual` | number \| null | Actual `coverage`; `null` when the view wasn't in this run. |
| `status` | `"passed"` \| `"failed"` \| `"missing"` | `missing` only warns; the run fails when any check is `failed`. |

## Insights

`insights.mostRepeated`: up to 10 elements used by at least 2 tests, most first. Each is `{ view, key, label, testCount, interactionCount, testShare }`, where `testShare` is `testCount` as a percent of `tests.length`. These are often setup steps repeated in every test.

## Example

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-01-01T12:00:00.000Z",
  "generator": { "name": "playwright-ui-coverage", "version": "0.1.0" },
  "summary": {
    "viewCount": 1,
    "coverage": 50,
    "testedElementsCount": 1,
    "untestedElementsCount": 1,
    "testedLinksCount": 0,
    "untestedLinksCount": 0,
    "failingOnlyElementsCount": 0,
    "a11yHintsCount": 0
  },
  "views": [
    {
      "name": "/users/:id",
      "reportUrl": "index.html#%2Fusers%2F%3Aid",
      "summary": {
        "coverage": 50,
        "testedElementsCount": 1,
        "untestedElementsCount": 1,
        "testedLinksCount": 0,
        "untestedLinksCount": 0,
        "failingOnlyElementsCount": 0,
        "a11yHintsCount": 0
      },
      "elements": [
        {
          "key": "[data-action=\"delete-user\"]",
          "label": "button \"Delete\"",
          "tag": "button",
          "instances": 1,
          "tested": false,
          "testIds": [],
          "failingTestIds": [],
          "interactionCounts": {},
          "role": "button",
          "name": "Delete",
          "nameFrom": "text",
          "attrs": { "data-action": "delete-user" },
          "suggestedLocator": "await page.getByRole('button', { name: 'Delete' }).click();"
        },
        {
          "key": "main > div:nth-of-type(1) > a",
          "label": "link \"← Back to users\"",
          "tag": "a",
          "instances": 1,
          "tested": true,
          "testIds": ["7d08affc2ce055c80dfd-96667847379d7d7361ae"],
          "failingTestIds": [],
          "interactionCounts": { "click": 1 },
          "role": "link",
          "name": "← Back to users",
          "nameFrom": "text",
          "attrs": { "href": "/users" }
        }
      ],
      "screenshots": []
    }
  ],
  "tests": [
    { "id": "7d08affc2ce055c80dfd-96667847379d7d7361ae", "title": "users.spec.ts › open a user", "project": "chromium", "passed": true, "retry": 0 }
  ],
  "thresholds": [{ "scope": "overall", "required": 30, "actual": 50, "status": "passed" }],
  "insights": { "mostRepeated": [] }
}
```

## Changes from the unversioned format (before schema version 1)

| Before | Version 1 |
|---|---|
| `total`, `tested`, `percent`, `failingOnly`, `a11yHints` at the top level | `summary.{testedElementsCount, untestedElementsCount, coverage, failingOnlyElementsCount, a11yHintsCount}`, plus `viewCount` and link counts |
| `routes[]` with `route`, `total`, `tested`, `percent`, `failingOnly`, `a11yHints` | `views[]` with `name`, `reportUrl` and `summary` |
| element `testedBy` / `testedByFailing` (titles) | `testIds` / `failingTestIds` (always present; titles in `tests`) |
| element `interactionTotal`, `testCount` | removed: sum `interactionCounts`, use `testIds.length` |
| `screenshots[].source`, `.test` (title) | `screenshots[].file`, `.testId` (internal) |
| `tests[].run` | `tests[].retry`, plus `passed` |
| `htmlReport` | `playwrightReport` |
| `mostRepeated[]` with `route`, `tests`, `interactions`, `share` | `insights.mostRepeated[]` with `view`, `testCount`, `interactionCount`, `testShare` |
| `thresholds[]` only when configured, with `target`, `passed` | always present, with `scope` and `view`; use `status` |
