# GitHub Actions: baseline gate, step summary and PR comment

An example workflow for a project that uses playwright-ui-coverage. It:

1. runs the Playwright tests with the baseline check (`baseline` option) and the step summary (`githubSummary`);
2. uploads `ui-coverage-report/` as an artifact, so later runs on pull requests can compare with the one from `main`;
3. on pull requests, downloads the `ui-coverage-report` artifact of the latest successful run on `main`, runs `playwright-ui-coverage compare`, and posts the markdown as a sticky comment (one comment per PR, updated on every push).

This file is documentation: copy the workflow into your project's `.github/workflows/`.

## Reporter options

```ts
// playwright.config.ts
reporter: [
  ['html', { open: 'never' }],
  ['playwright-ui-coverage/reporter', {
    // Fail only on new untested elements; ui-coverage-baseline.json is committed.
    baseline: 'ui-coverage-baseline.json',
    // Append a summary to the job's page (only when $GITHUB_STEP_SUMMARY is set).
    githubSummary: true,
  }],
],
```

Create the baseline once (`npx playwright test` with `baseline: { file: 'ui-coverage-baseline.json', mode: 'update' }`, or `npx playwright-ui-coverage baseline update` after a run) and commit it. Add `*.next.json` to `.gitignore`.

## Workflow

```yaml
# .github/workflows/e2e.yml
name: E2E

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read
  actions: read          # download artifacts of other runs
  pull-requests: write   # sticky comment

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium

      # Fails the job on failing tests, thresholds, or new untested elements
      # (baseline). Keep going so the report is uploaded and the PR comment
      # is posted either way; the last step fails the job.
      - name: Playwright tests
        id: tests
        continue-on-error: true
        run: npx playwright test

      - uses: actions/upload-artifact@v5
        if: always()
        with:
          name: ui-coverage-report
          path: ui-coverage-report/
          retention-days: 30

      # The baseline with this run's improvements: download it, commit it as
      # ui-coverage-baseline.json to ratchet.
      - uses: actions/upload-artifact@v5
        if: always()
        with:
          name: ui-coverage-baseline-next
          path: ui-coverage-baseline.next.json
          if-no-files-found: ignore

      # ---- Pull requests: compare with main and comment ---------------------
      - name: Download coverage.json from main
        if: github.event_name == 'pull_request'
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          run_id=$(gh run list --repo "$GITHUB_REPOSITORY" --workflow e2e.yml --branch main \
            --event push --status success --limit 1 --json databaseId --jq '.[0].databaseId')
          if [ -n "$run_id" ]; then
            gh run download "$run_id" --repo "$GITHUB_REPOSITORY" --name ui-coverage-report --dir base-report || true
          fi

      - name: Compare
        if: github.event_name == 'pull_request'
        run: |
          if [ -f base-report/coverage.json ]; then
            npx playwright-ui-coverage compare base-report/coverage.json ui-coverage-report/coverage.json --out ui-coverage-comment.md
          else
            # No run on main yet: post this run's summary instead.
            npx playwright-ui-coverage summary ui-coverage-report/coverage.json --out ui-coverage-comment.md
          fi
          cat ui-coverage-comment.md >> "$GITHUB_STEP_SUMMARY"

      # Creates the comment, or updates it: the markdown starts with
      # <!-- playwright-ui-coverage -->, which is how the comment is found again.
      - name: Sticky PR comment
        if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository
        env:
          GH_TOKEN: ${{ github.token }}
          PR: ${{ github.event.pull_request.number }}
        run: |
          id=$(gh api "repos/$GITHUB_REPOSITORY/issues/$PR/comments" --paginate \
            --jq '[.[] | select(.body | startswith("<!-- playwright-ui-coverage -->"))][0].id // empty')
          if [ -n "$id" ]; then
            gh api --method PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id" -F body=@ui-coverage-comment.md > /dev/null
          else
            gh pr comment "$PR" --body-file ui-coverage-comment.md
          fi

      - name: Fail if the tests failed
        if: steps.tests.outcome == 'failure'
        run: exit 1
```

Notes:

- **Sticky comment with an action instead of `gh`:** [`marocchino/sticky-pull-request-comment`](https://github.com/marocchino/sticky-pull-request-comment) works too: `with: { header: playwright-ui-coverage, path: ui-coverage-comment.md }`.
- **Pull requests from forks** get a read-only token, so the comment step is skipped for them (the condition above); the step summary still shows the comparison. To comment on fork PRs, post from a separate `workflow_run` workflow.
- **Links to the report:** if you publish the HTML report (GitHub Pages, an artifact viewer…), pass `--report-url https://…/index.html` to `compare`/`summary` so view names link to it.
- **Sharded runs:** run the shards with `--reporter=blob`, merge with `npx playwright merge-reports --config merge.config.ts all-blob-reports` (with `baseline` and `githubSummary` in the merge config's reporter options), and do the steps above in the merge job.
- **Baseline vs. compare:** the baseline check is the gate (it decides pass/fail against a committed file, so it works without artifacts); `compare` is informational (what this PR changes compared with `main`). Use either or both.
