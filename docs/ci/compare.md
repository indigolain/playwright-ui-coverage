# Comparing runs and PR comments

This page shows how to compare two runs (say, `main` and a pull request) to see what a change did to UI coverage, post the result as a sticky PR comment, and write a summary to the GitHub Actions job page.

## compare

`compare` diffs two `coverage.json` files, e.g. the latest run on `main` and the pull request's run:

```bash
npx playwright-ui-coverage compare base/coverage.json ui-coverage-report/coverage.json [--format markdown|json] [--out file] [--report-url <url>] [--title <text>]
```

It reports:

- the overall and per-view coverage delta;
- **new untested elements and links**, with why: `was tested`, `new element` / `new link`, `new view`;
- **resolved** gaps (untested in base, tested now);
- added, removed and renamed views (matched by similar keys, like the [baseline](./baseline.md#what-happens-in-check-mode));
- threshold checks whose status changed.

Elements are matched by `(view, key)`, link units by `(view, destination view)`.

`compare` always exits with 0 (2 on errors): it's informational. Gate with [`threshold`](./thresholds.md) or [`baseline`](./baseline.md).

## The markdown

The markdown is meant for a sticky PR comment:

- it starts with `<!-- playwright-ui-coverage -->`, so a workflow can find and update its comment;
- it lists only changed views, collapses long lists in `<details>` and truncates them at 50 entries;
- it is deterministic: no timestamps, stable order.

For example:

```md
<!-- playwright-ui-coverage -->
### UI coverage: 56.2% (-1.1 pp)

| | Coverage | Tested | Views |
|---|---:|---:|---:|
| Base | 57.3% | 51/89 | 7 |
| Head | **56.2%** | 50/89 | 7 |

**1 new untested element** · 0 resolved

**Views changed (1), 6 unchanged**

| View | Base | Head | Δ | New gaps | Resolved |
|---|---:|---:|---:|---:|---:|
| `/settings` | 45.5% (5/11) | 36.4% (4/11) | -9.1 pp | 1 | 0 |

**New untested elements (1)**

- `/settings` checkbox "Email notifications" (was tested) `#notify`
```

`--report-url` (where you publish the HTML report) turns view names into links. `--title` changes the heading (default "UI coverage").

`--format json` writes the same data (`CoverageComparison` in [src/compare.ts](https://github.com/indigolain/playwright-ui-coverage/blob/main/src/compare.ts), `comparisonVersion: 1`).

## Step summary

With `githubSummary: true`, the reporter (and the `report` CLI) appends a markdown summary to the file in `$GITHUB_STEP_SUMMARY`: coverage per view, failing thresholds and the baseline result. It's off by default; outside GitHub Actions (variable not set) it does nothing.

```ts
// ui-coverage.config.ts
export default defineUiCoverageConfig({ githubSummary: true });
```

`npx playwright-ui-coverage summary [coverage.json]` prints the same markdown, e.g. for a PR comment when there's no base run to compare with. It takes `--out`, `--report-url` and `--title` like `compare`.

## A complete workflow

[GitHub Actions workflow](../github-actions.md) downloads the base artifact from `main`, runs the tests, compares, and posts or updates a sticky comment.

## In your own tooling

The functions are exported from `playwright-ui-coverage`: `compareReports`, `comparisonMarkdown`, `reportMarkdown`, `checkBaseline`, `createBaseline`.

```ts
import fs from 'node:fs';
import { compareReports, comparisonMarkdown, type CoverageReport } from 'playwright-ui-coverage';

const read = (f: string): CoverageReport => JSON.parse(fs.readFileSync(f, 'utf8'));
const comparison = compareReports(read('base/coverage.json'), read('ui-coverage-report/coverage.json'));
console.log(comparisonMarkdown(comparison));
```
