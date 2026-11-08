# Compatibility

This page lists the Playwright versions, browsers and Node.js versions the library supports, and how its output formats are versioned.

> Status: early development (0.1.0). APIs may change.

## Playwright

- **`@playwright/test` 1.50 or later** (a peer dependency).
- CI runs the demo in both recording modes on Chromium, Firefox and WebKit with `@playwright/test` 1.50.0 and the latest release, and weekly against `@playwright/test@next`.
- Older versions still record coverage, but show an extra `attach "ui-coverage"` step in each test's report.
- **Register mode** (`playwright-ui-coverage/register`) hooks into Playwright's private instrumentation API. If a Playwright release changes it, register mode switches itself off with a warning (`UICOV_STRICT=1` makes that an error); the fixture mode isn't affected. The weekly run against `@next` is there to catch such changes before they ship.
- **Component testing:** install `@playwright/test` at the same version as your `@playwright/experimental-ct-*` package, see [Component testing](../guide/component-testing.md#notes).

## Browsers

Chromium, Firefox and WebKit, in every combination above. Browser-specific behavior:

- Full-page screenshots in all three paint `position: fixed` and `sticky` elements at the scroll position the page had, see [Fixed and sticky elements](../guide/screenshots.md#fixed-and-sticky-elements).
- Chromium paints cross-origin iframes that run in their own process only where they are inside the viewport, see [Known limitations](./limitations.md).

## Node.js

The versions your Playwright release supports. CI uses Node.js 22. TypeScript config files are loaded through Playwright's own TypeScript support, and URL patterns are implemented by the library, so neither needs a particular Node.js version.

## Output formats

| File | Version field | Policy |
|---|---|---|
| `coverage.json` | `schemaVersion: 1` | Changes only on breaking changes; fields may be added at any time. See [coverage.json compatibility](../coverage-json.md#compatibility). |
| `ui-coverage-baseline.json` | `baselineVersion: 1` | See [Baseline](../ci/baseline.md#the-file). |
| `compare --format json` | `comparisonVersion: 1` | See [Comparing runs](../ci/compare.md). |
| `data/ui-coverage-data.json` | `formatVersion: 1` (recordings: 3, version 2 still read) | Input for rebuilds, not a stable contract. See [Raw data format](./raw-data.md). |
