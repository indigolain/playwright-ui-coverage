# Sharding and merge-reports

This page shows how to collect UI coverage from sharded runs and merge it into one report with `npx playwright merge-reports`.

Coverage data and screenshots are stored as test attachments, so they travel with Playwright's `blob` reporter. Run each shard with the blob reporter, then merge on any machine with the UI coverage reporter:

```bash
# on each CI job
npx playwright test --shard=1/2 --reporter=blob
npx playwright test --shard=2/2 --reporter=blob

# after collecting every blob-report/*.zip into all-blob-reports/
npx playwright merge-reports --reporter playwright-ui-coverage/reporter all-blob-reports
```

The merged report is the same as one from an unsharded run.

## Config when merging

The reporter finds `ui-coverage.config.*` next to the config `merge-reports` uses (with `--reporter` alone and no `--config`, that's the working directory), or through `UI_COVERAGE_CONFIG`.

Options set inline in `playwright.config.ts` aren't seen by `merge-reports`. Pass them in a merge config:

```ts
// merge.config.ts
export default {
  reporter: [['playwright-ui-coverage/reporter', { configFile: './ui-coverage.config.ts', threshold: 30 }]],
};
```

```bash
npx playwright merge-reports --config merge.config.ts all-blob-reports
```

To keep links from "Tested by" to Playwright's HTML report, put both reporters in the merge config; with `--reporter html,playwright-ui-coverage/reporter` on the command line the reporter can't see the HTML reporter's options, so there are no links. See [Insights and the HTML report](./insights.md#links-to-the-html-report-and-traces).

## Recording in the shards

The shards record with the config file too: `recording`, and a [profile](../reference/configuration.md#profiles) selected by each test's project and tags, or by `UI_COVERAGE_PROFILE`. (When the run has no UI coverage reporter, as with `--reporter=blob`, each test selects the profile itself.)

## In CI

For a GitHub Actions setup with shards, do the baseline, comparison and comment steps in the merge job, with `baseline` and `githubSummary` in the merge config's reporter options. See [GitHub Actions workflow](../github-actions.md).
