# Baseline (ratchet)

This page shows how to fail a run only when it adds *new* untested elements, by committing a list of what's untested today. It's the easiest way to adopt UI coverage as a gate on a suite that doesn't cover everything yet.

A baseline is a ratchet: commit the list of what's untested today, and a run fails only when a view has an untested element that isn't on the list. When elements get tested, you shrink the list.

## Set it up

```ts
// ui-coverage.config.ts
import { defineUiCoverageConfig } from 'playwright-ui-coverage/config';

export default defineUiCoverageConfig({
  baseline: 'ui-coverage-baseline.json',   // = { file: 'ui-coverage-baseline.json', mode: 'check' }
});
```

```bash
npx playwright test                              # writes ui-coverage-report/coverage.json
npx playwright-ui-coverage baseline update       # writes ui-coverage-baseline.json from it; commit it
```

Add `*.next.json` to `.gitignore`.

## Options

| `baseline` | |
|---|---|
| `'file.json'` / `true` | `{ file, mode: 'check' }`; `true` uses `ui-coverage-baseline.json`. Relative to the config file. |
| `file` | Default `ui-coverage-baseline.json`. |
| `mode` | `'check'` (default): fail on new gaps and write the current state to `<file>.next.json` (`ui-coverage-baseline.next.json`). `'update'`: rewrite `<file>` with the current state; never fails. `'off'`: nothing. |
| `allowNewViews` | Default `false`: untested elements of a view the baseline doesn't have are new gaps (a new page needs tests, or a baseline update). `true`: new views are listed but don't fail. |

## The file

The file lists, per view, the keys of its untested elements and the destination views of its untested links (sorted, one per line, so diffs review well). Views with nothing untested are kept with an empty list, so "fully tested" and "new view" stay different:

```json
{
  "baselineVersion": 1,
  "views": {
    "/settings": { "untestedElements": ["#bio", "#theme", "[data-testid=\"delete-account\"]"], "untestedLinks": ["/settings/audit"] },
    "/users": { "untestedElements": [] }
  }
}
```

`untestedLinks` is there only when the view has untested [link units](../guide/links.md). Keys are [element keys](../guide/element-identity.md), so stable keys (`data-testid`, [named elements](../guide/rules.md#named-elements)) make for a stable baseline.

## What happens in check mode

- A view in both: its untested elements and links not in the baseline are **new gaps** and fail the run (exit code 1, like a threshold). Elements the baseline lists that are now tested, or gone, are **resolved**.
- **Ratchet:** `<file>.next.json` is always written with the current state. When elements got tested, the run says so; copy `.next.json` over the baseline (or run `baseline update`) and commit.
- **Renamed views** (a `normalizeUrl` or `views` change, a route moved): a view that disappeared and one that appeared with mostly the same untested keys (Jaccard index ≥ 0.5) are matched and compared as one, reported as `view renamed?`.
- **Removed views** (in the baseline, not in the run) are reported and never fail; a filtered run (`--grep`) doesn't visit every view. Compare against full runs: in a filtered run, a view that *was* visited can have elements that other tests normally cover.
- **No baseline file yet:** a warning, not a failure, and `.next.json` is written so you can commit it.
- **Accepting a gap on purpose:** commit the new state (`baseline update`), so the PR shows the added keys.

```
UI coverage baseline: 1 new untested element(s) not in ui-coverage-baseline.json:
    /settings  checkbox "Email notifications"  #notify
  Test them, or accept them by committing ui-coverage-baseline.next.json as ui-coverage-baseline.json (`npx playwright-ui-coverage baseline update`).
```

`coverage.json` has the result in `baseline` (`status`, `newGaps`, `resolved`, `addedViews`, `removedViews`, `renamedViews`); see [coverage.json](../coverage-json.md#baseline-baselinecheck).

## From the command line

The CLI checks or updates a baseline from an existing `coverage.json`, without running tests:

```bash
npx playwright-ui-coverage baseline check  [--report ui-coverage-report/coverage.json] [--file ui-coverage-baseline.json] [--allow-new-views] [--config <file>]
npx playwright-ui-coverage baseline update [--report ui-coverage-report/coverage.json] [--file ui-coverage-baseline.json] [--config <file>]
```

`--config` reads `outputFolder` and `baseline` from the config. `check` exits with 1 on new gaps (and writes `.next.json`), 2 on errors. See the [CLI reference](../reference/cli.md#baseline).

## Upgrading to link units

A baseline written before [link units](../guide/links.md) lists `<a>` elements as untested elements: they show as resolved (`removed`) and the link units as new gaps. Run `baseline update` once after upgrading.

## In GitHub Actions

[GitHub Actions workflow](../github-actions.md) shows a complete workflow with the baseline check, the step summary and a PR comment.
