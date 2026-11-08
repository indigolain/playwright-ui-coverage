# CLI

This page is the reference for the `playwright-ui-coverage` command: rebuilding the report, checking and updating a baseline, comparing runs, and printing a summary. It works on files the reporter already wrote, so none of the commands run tests.

```bash
npx playwright-ui-coverage <command> [options]
npx playwright-ui-coverage --help
```

| Command | What it does |
|---|---|
| [`report`](#report) | Rebuild the report (`index.html`, `coverage.json`) from stored data, applying the rules in the config file. |
| [`baseline check`](#baseline) | Exit 1 if `coverage.json` has untested elements the baseline doesn't list; writes `<file>.next.json`. |
| [`baseline update`](#baseline) | Write the baseline file from `coverage.json`. |
| [`compare <base> <head>`](#compare) | Compare two `coverage.json` files: coverage delta, new untested elements, resolved gaps, added/removed views. |
| [`summary [coverage.json]`](#summary) | Markdown summary of one run (what `githubSummary` writes). |

## Exit codes

| Code | Meaning |
|---|---|
| `0` | OK. `compare` and `summary` always exit with 0 unless there's an error. |
| `1` | A threshold isn't met, or the baseline check found new untested elements (`report`, `baseline check`). |
| `2` | Usage or input error: bad flags, unreadable data, an invalid config, an unknown profile. |

## report

Rebuild the report from the data folder the reporter keeps (`ui-coverage-report/data/`), e.g. after changing a filter, without running the tests:

```bash
npx playwright-ui-coverage report
npx playwright-ui-coverage report --profile pr-critical
npx playwright-ui-coverage report --data ci-artifacts/ui-coverage-report/data --config other.config.mjs --out ui-coverage-report
```

| Flag | Default | |
|---|---|---|
| `--config <file>` | `UI_COVERAGE_CONFIG`, else `ui-coverage.config.*` in the working directory, else default options | The [config file](./configuration.md): `.json`, `.js`/`.cjs` (`module.exports = {…}`), `.mjs` (`export default {…}`), `.ts`/`.mts`/`.cts` (loaded with Playwright's TypeScript support). Relative paths in it resolve from its folder. `recording` is ignored here (nothing is recorded). |
| `--profile <name>` | `UI_COVERAGE_PROFILE`, else the profile the reporter used, else automatic | The [profile](./configuration.md#profiles) to apply; `''` for none. |
| `--data <dir>` | `data/` in the config's `outputFolder` (else `ui-coverage-report/data`) | The data folder. |
| `--out <dir>` | the folder that contains `--data` | Where to write the report. Only `index.html`, `coverage.json` and `screens/` are replaced; nothing else is deleted. |

`threshold` and `baseline` are checked like in the reporter: the CLI exits with code 1 if a threshold isn't met or there are new untested elements, and 2 on errors. With `githubSummary: true` it appends the step summary too.

What a rebuild can and can't change is described in [How it works](../guide/how-it-works.md#rebuilding-the-report).

## baseline

Check or update a [baseline](../ci/baseline.md) from an existing `coverage.json`:

```bash
npx playwright-ui-coverage baseline check  [--report ui-coverage-report/coverage.json] [--file ui-coverage-baseline.json] [--allow-new-views] [--config <file>]
npx playwright-ui-coverage baseline update [--report ui-coverage-report/coverage.json] [--file ui-coverage-baseline.json] [--config <file>]
```

| Flag | Default | |
|---|---|---|
| `--report <file>` | `coverage.json` in the config's `outputFolder`, else `ui-coverage-report/coverage.json` | The run to check. |
| `--file <file>` | the config's `baseline.file`, else `ui-coverage-baseline.json` | The baseline file. |
| `--allow-new-views` | off | `check`: untested elements of views not in the baseline don't fail. |
| `--config <file>` | as for `report` | Reads `outputFolder` and `baseline` from the config. |
| `--profile <name>` | `UI_COVERAGE_PROFILE` | The profile to apply. |

`check` exits with 1 on new gaps (and writes `<file>.next.json`), 2 on errors.

## compare

Compare two `coverage.json` files, e.g. the latest run on `main` and a pull request's run. See [Comparing runs and PR comments](../ci/compare.md) for what it reports.

```bash
npx playwright-ui-coverage compare base/coverage.json ui-coverage-report/coverage.json [--format markdown|json] [--out file] [--report-url <url>] [--title <text>]
```

| Flag | Default | |
|---|---|---|
| `--format <fmt>` | `markdown` | `markdown` (for a sticky PR comment) or `json` (`CoverageComparison`, `comparisonVersion: 1`). |
| `--out <file>` | stdout | Write to a file instead. |
| `--report-url <url>` | none | URL of the published HTML report: view names link to it. |
| `--title <text>` | `UI coverage` | The heading. |

## summary

Print the markdown summary of one run (the same as `githubSummary` writes), e.g. for a PR comment when there's no base run to compare with:

```bash
npx playwright-ui-coverage summary [ui-coverage-report/coverage.json] [--out file] [--report-url <url>] [--title <text>]
```

It takes `--out`, `--report-url` and `--title` like `compare`.
