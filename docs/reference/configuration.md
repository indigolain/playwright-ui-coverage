# Configuration file

This page is the reference for `ui-coverage.config.ts`: every key, where the config is loaded from, how layers override each other, profiles, and validation.

All settings live in one file, `ui-coverage.config.ts` next to `playwright.config.ts`. The recorder (in both modes), the reporter and the [`report` CLI](./cli.md#report) all read it. With the file in place the reporter needs no options: `['playwright-ui-coverage/reporter']`.

```ts
// ui-coverage.config.ts
import { DEFAULT_INTERACTIONS, defineUiCoverageConfig } from 'playwright-ui-coverage';

export default defineUiCoverageConfig({
  // Report-time rules: change them and rebuild the report without running tests.
  elementFilters: [{ selector: '.cookie-banner *', include: false }],
  elements: [{ selector: '#main-nav [href="/"]', name: 'Logo home link' }],
  significantAttributes: ['data-component'],
  attributeFilters: [{ attribute: 'id', value: 'tmp-.*', comment: 'ids from the legacy form builder' }],

  // Views: which URLs are one page in the report, and which aren't part of it.
  views: ['/users/:username', { pattern: '/docs/:section/*', groupBy: ['section'] }],
  viewFilters: [{ pattern: 'https://auth.example.com/*', include: false }],

  // Reporter settings.
  outputFolder: 'ui-coverage-report',
  threshold: { overall: 60 },

  // Recording options: what the tests capture while they run.
  recording: {
    screenshots: 'first-only',
    interactions: [...DEFAULT_INTERACTIONS, 'focus'],
  },

  // Named overrides, e.g. a stricter config for PR runs.
  profiles: [
    { name: 'pr-critical', tags: ['@pr-critical'], config: { threshold: { overall: 90 } } },
  ],
});
```

`defineUiCoverageConfig` only adds types (`UiCoverageConfig`). `playwright-ui-coverage/config` exports it too, without loading `@playwright/test`:

```ts
import { defineUiCoverageConfig } from 'playwright-ui-coverage/config';
```

## Keys

| Key | Applied | Documentation |
|---|---|---|
| `elementFilters`, `elements`, `significantAttributes`, `attributeFilters` (and the deprecated `ignoreSelectors`) | report time | [Report-time rules](../guide/rules.md) |
| `elementGroups`, `autoGroup` | report time | [Element grouping](../guide/element-grouping.md) |
| `links` | report time | [Links and untested views](../guide/links.md) |
| `views`, `viewFilters`, `normalizeUrl` | report time | [Views](../guide/views.md) |
| `outputFolder`, `maxScreenshotsPerRoute`, `threshold`, `countFailedTests`, `viewBy`, `htmlReport`, `testIdAttribute`, `saveData`, `baseline`, `githubSummary` | report time | [Reporter options](./settings.md) |
| `recording` | while tests run | [Recording options](./recording-options.md) |
| `profiles` | | [Profiles](#profiles) |
| `comment` | | Free text, ignored. Every rule object (`elementFilters`, `elements`, `attributeFilters`, `elementGroups`, `views`, `viewFilters` and `allowedInteractions` entries, profiles) takes a `comment` too. |

Report-time keys are applied when the report is built, so you can change them and [rebuild the report](../guide/how-it-works.md#rebuilding-the-report) without running the tests. Recording options decide what is captured; changing them needs a new run.

## Where the config comes from

- **The file:** `ui-coverage.config.ts` (or `.mts`, `.cts`, `.mjs`, `.js`, `.cjs`, `.json`) in the directory of the Playwright config. Two of them in one directory is an error. Inside Playwright, TypeScript configs load through Playwright's own TypeScript support, so any Node.js version works. Functions like `normalizeUrl` need a JS/TS config.
- **Another path:** the `UI_COVERAGE_CONFIG` environment variable (relative to the working directory), or the reporter option `configFile` (relative to the Playwright config; `false`: no file). The environment variable wins. The reporter passes the file it uses on to the test workers, so the recorder reads the same one.
- **Inline:** the same keys in the reporter options, `['playwright-ui-coverage/reporter', { threshold: 80 }]`, except `recording` (the recorder runs in the test workers and can't see reporter options, so that's an error). The CLI reads only the file, so keep everything you want to rebuild with in the file.

## Precedence

Each layer wins over the ones before it, key by key:

| | lowest → highest |
|---|---|
| Report-time keys | defaults → rules recorded with the data (deprecated `use.uiCoverage` rules) → config file → reporter options → selected profile |
| Recording options | defaults → `recording` in the config file → the selected profile's `recording` → `use.uiCoverage` in the Playwright config |

`use.uiCoverage` (in `playwright.config.ts`, per project if you like) keeps working and has the last word on recording options, see [Recording options](./recording-options.md#per-project-useuicoverage).

Merging: a key that is set replaces the value below it. Lists replace (they're never concatenated). Objects (`recording`, `threshold` as an object) are merged one level deep, so a profile with `threshold: { overall: 90 }` keeps the base `threshold.views`. A key set to `undefined` counts as not set.

## Profiles

Profiles are named overrides of the base config:

```ts
profiles: [
  { name: 'pr-critical', tags: ['@pr-critical'], config: { threshold: { overall: 90 }, elementFilters: [{ selector: 'footer *', include: false }] } },
  { name: 'mobile', projects: ['mobile-chrome', 'mobile-safari'], config: { recording: { screenshots: 'off' } } },
  { name: 'nightly', comment: 'selected explicitly', config: { countFailedTests: true } },
],
```

A profile's `config` takes every top-level key except `profiles`, and is merged over the base config as described above. A run uses one profile, or none:

1. **Explicit:** `UI_COVERAGE_PROFILE=<name>`, else the reporter option `profile`. In the CLI, `--profile <name>` wins over both. An unknown name is an error that lists the defined ones; an empty value selects no profile.
2. **Automatic:** otherwise the **first** profile that matches the run:
   - `projects`: every project with tests in the run is listed (`npx playwright test --project=mobile-chrome`);
   - `tags`: every test in the run has one of these tags (`npx playwright test --grep @pr-critical`; the `@` is optional);
   - both set: both must match. A profile with neither is only selected explicitly.

The reporter selects the profile when the run starts, and the test workers record with it. When the run has no UI coverage reporter (`--reporter=blob` shards), each test selects with its own project and tags, or with `UI_COVERAGE_PROFILE`. The CLI uses `--profile`, else `UI_COVERAGE_PROFILE`, else the profile the reporter used (recorded in the data folder), else automatic selection from the recorded tests. The reporter and the CLI print `UI coverage profile: <name>` when one is used.

## Validation

The config is checked when the reporter starts, by the CLI, and by the recorder in each worker. Every problem is reported at once, with its location:

```
[playwright-ui-coverage] invalid ui-coverage.config.ts:
  - ignoreSelector: unknown key (did you mean "ignoreSelectors"?)
  - snapshotDelay: is a recording option: put it in `recording: { snapshotDelay }`
  - profiles[0].config.threshold.overall: must be ≤ 100, got 120
  - attributeFilters[1].value: invalid regular expression: …
  - views[0].groupBy[0]: "sectoin" is not a named parameter of the pattern (it has "section")
```

Unknown keys, wrong types, unknown interaction types, invalid regular expressions, URL patterns and selectors that can't be evaluated at report time, and duplicate `elements` names are all errors.

## The resolved config in coverage.json

`coverage.json` and `data/ui-coverage-data.json` record which config built the report:

```json
"config": {
  "source": { "file": "ui-coverage.config.ts", "inline": ["threshold"] },
  "profile": "pr-critical",
  "resolved": { "significantAttributes": ["data-component"], "threshold": { "overall": 90 }, "recording": { "screenshots": "first-only" } }
}
```

`source.file` is relative to the working directory (`null` without a file). `source.inline` lists the keys set in the reporter options. `resolved` is the merged config without `profiles`; functions appear as `"[function name]"`. Its `recording` is what the config sets; `use.uiCoverage` may override it per project.

## Environment variables

| Variable | Effect |
|---|---|
| `UI_COVERAGE_CONFIG` | Path to the config file (relative to the working directory). Wins over the reporter's `configFile`. |
| `UI_COVERAGE_PROFILE` | Selects a [profile](#profiles); empty selects none. |
| `UICOV_STRICT` | Set (e.g. `1`): register mode fails instead of warning when the Playwright version doesn't support it. |
| `PLAYWRIGHT_HTML_OUTPUT_DIR` (or `PLAYWRIGHT_HTML_REPORT`), `PLAYWRIGHT_HTML_ATTACHMENTS_BASE_URL` | Read like Playwright's HTML reporter reads them, to build the ["Tested by" links](../guide/insights.md#links-to-the-html-report-and-traces). |

## Types

Exported from `playwright-ui-coverage`: `UiCoverageConfig`, `UiCoverageProfile`, `UiCoverageRecordingConfig`, `UiCoverageReporterOptions`, `UiCoverageRules` (the report-time rules) and `UiCoverageOptions` (recording options in `use.uiCoverage`). `playwright-ui-coverage/config` exports `defineUiCoverageConfig` and the `UiCoverageConfig`, `UiCoverageProfile`, `UiCoverageRecordingConfig` and `UiCoverageReporterOptions` types without loading `@playwright/test`.
