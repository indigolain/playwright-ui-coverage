# How it works

This page explains the three stages, recording in the browser, raw data, and rules applied when the report is built, so you know which settings need a new test run and which only need a rebuild.

## 1. Recording, in the browser

**Tracker.** An init script (`addInitScript`) installs capture-phase listeners that record every interaction on an [interactive element](./which-elements-count.md): `click`, `input`, `change`, `submit`, `dblclick`, `contextmenu`, keyboard activation, drag and drop, and opt-in `scroll`, `focus` and `blur` (see [Interaction types](./which-elements-count.md#interaction-types)). It doesn't matter which Playwright API (or a real user) caused the event.

**Inventory and screenshot.** When a page loads and shortly after interactions (`snapshotDelay`), the recorder lists every visible interactive element, with bounding boxes, and takes a full-page screenshot. It only takes a new screenshot when new elements appear. When an interaction makes new elements appear (a modal opens), the page sends an inventory as soon as its handlers have run, and the recorder takes a viewport screenshot right away, so states a test closes again within a few milliseconds get a screenshot too (`captureTransientStates`, see [Screenshots](./screenshots.md#short-lived-states)).

The recorder stores **raw facts** (tag, attributes, position among siblings, ancestors, accessible name), not keys: identity and filtering are decided later. Each element's `role`, accessible `name` and where the name came from (`nameFrom`: `aria-labelledby`, `aria-label`, `label`, `placeholder`, `title`, `alt`, `value`, `text`, or `name` for the name attribute) are recorded too; [suggested locators and accessibility hints](./locators-and-accessibility.md) are built from them.

Recording covers every page and popup of the test's browser context, in both [setup modes](./getting-started.md#turn-recording-on). Its calls are marked as internal, so it adds no steps to your HTML report or trace.

## 2. Raw data

Each test attempt's recording is stored as a test attachment (`ui-coverage`, plus one `ui-coverage-screenshot-<n>` attachment per screenshot). That's why it travels with Playwright's `blob` reporter, see [Sharding and merge-reports](./sharding.md).

The reporter also keeps the raw recordings next to the report:

```
ui-coverage-report/
  index.html, coverage.json, screens/   ← the report
  data/
    ui-coverage-data.json               ← every test attempt's raw recording
    screenshots/                        ← every screenshot, not just the ones the report shows
```

`saveData: false` turns this off. The format is described in [Raw data format](../reference/raw-data.md).

## 3. Report time: rules, grouping, scores

The reporter merges the data from all workers, then:

1. applies the [report-time rules](./rules.md): which elements count (`elementFilters`), [identity](./element-identity.md) (`elements`, `significantAttributes`, `attributeFilters`) and [grouping](./element-grouping.md);
2. maps URLs to [views](./views.md) (`/users/42` → `/users/:id`), and links to the views they lead to;
3. marks an element *tested* if any counted test interacted with it, and a link *tested* if any counted test visited the view it leads to ([retries](./retries.md) decide which attempts count);
4. writes the HTML report and [`coverage.json`](../coverage-json.md), and checks [thresholds](../ci/thresholds.md) and the [baseline](../ci/baseline.md).

## Rebuilding the report

Because rules are applied at report time, you can change them and rebuild the report from `data/` without running the tests:

```bash
npx playwright-ui-coverage report
```

See the [`report` command](../reference/cli.md#report) for its flags.

**What a rebuild can change:** everything the reporter does with the data: report-time rules, `views`, `viewFilters`, `normalizeUrl`, `viewBy`, `threshold`, `countFailedTests`, `maxScreenshotsPerRoute`. Links to the HTML report are kept and adjusted to `--out` (`htmlReport: false` drops them).

**What it can't change:** what was recorded.

- Which elements are interactive is decided in the browser, because it needs the live page (computed styles, descendants, label targets). That includes the `data-uicov-*` markup directives.
- Interaction types are recording options: events that weren't listened to can't be recovered.
- Screenshots are what they are.
- The deprecated `use.uiCoverage.ignoreSelectors` was applied while recording.

The [configuration reference](../reference/configuration.md#keys) lists for each key whether it applies at report time or while tests run.
