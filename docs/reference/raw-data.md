# Raw data format

This page describes the raw recordings the reporter keeps in `ui-coverage-report/data/`, which the [`report` CLI](./cli.md#report) rebuilds the report from. Most users never read these files; they matter if you archive runs or write your own tooling.

The raw data is input for rebuilding the report, not a stable contract like [`coverage.json`](../coverage-json.md). Its types are exported (`StoredData`, `StoredAttempt`, `RawCoverageData`, …) and versioned with `formatVersion`.

## The data folder

```
ui-coverage-report/
  index.html, coverage.json, screens/   ← the report
  data/
    ui-coverage-data.json               ← every test attempt's raw recording
    screenshots/                        ← every screenshot, not just the ones the report shows
```

The reporter writes it unless `saveData: false`.

## ui-coverage-data.json

`ui-coverage-data.json` has `formatVersion: 1` and an `attempts` array: one entry per test attempt and browser context with `testId`, `retry`, `passed`, `title`, `project`, `trace`, `tags`, `specFile` and `data`, the recording (`formatVersion: 3`, see `RawCoverageData` in [src/model/raw.ts](https://github.com/indigolain/playwright-ui-coverage/blob/main/src/model/raw.ts); version 2 is still read):

- `nodes`: a table of DOM elements, each `{ tag, parent?, nth?, of?, attrs? }`: the parent's index, the position among same-tag siblings (`:nth-of-type`), and the attributes. Ancestor chains are stored once and shared by every element under them. Tree boundaries are pseudo-nodes: an element at the top of a shadow root has a `{ tag: '#shadow-root' }` parent, whose parent is the shadow host, and a frame's `<html>` has a `{ tag: '#document' }` parent, whose parent is the `<iframe>`.
- `snapshots`: `{ url, dpr, viewport?, screenshot?, screenshotClip?, elements }`, with each element `{ node, name?, x, y, w, h, pos? }`. `name` is the accessible name, used for labels only; `candidateOnly: true` marks elements recorded although they aren't interactive, like `<label>`; `pos` is `fixed` or `sticky` when the element or an ancestor is. Boxes are in document CSS pixels. `viewport` is the scroll offset and viewport size; `screenshotClip` is the document region a viewport screenshot shows.
- `interactions`: `{ event, url, element: { node, name? } }`, pointing into the same node table, so an interaction resolves to the same key as the element in the inventory.
- `rules`: the deprecated `use.uiCoverage` identity rules, if any.

Attribute values are recorded up to 256 characters (`class` up to 1024), and `style` isn't recorded.

The file also has `config`, the [resolved config](./configuration.md#the-resolved-config-in-coveragejson) the reporter used; the CLI uses its `profile` when no other is chosen.

## Test attachments

The same recording is the `ui-coverage` test attachment (with one `ui-coverage-screenshot-<n>` attachment per screenshot), so [`merge-reports`](../guide/sharding.md) and the data folder carry identical data.

Attachments from earlier versions (no `formatVersion`, keys computed in the browser) are still read, but report-time rules can't change their keys.
