# Insights and the HTML report

This page covers two things that help you act on the report: links from each test to Playwright's HTML report and its trace, and the *Most repeated elements* list that points at repeated setup steps.

## Links to the HTML report and traces

When the config also has Playwright's `html` reporter, each test under "Tested by" links to its entry in the HTML report (`index.html#?testId=<id>&run=<attempt>`): for a flaky test the retry that passed, for a test that never passed its last attempt. If that attempt recorded a trace (`use: { trace: 'on' }` or similar), a **trace** link opens it in the trace viewer bundled with the HTML report.

The reporter reads the HTML reporter's `outputFolder` (and `PLAYWRIGHT_HTML_OUTPUT_DIR`, `attachmentsBaseURL`) from the config. Without the `html` reporter, tests are listed as plain text. The `htmlReport` reporter option sets the folder yourself, or turns the links off with `false`.

Links are relative, so the two reports must keep their relative position when you move or upload them. Two layouts work:

```ts
// playwright.config.ts

// 1. Side by side (default): playwright-report/ and ui-coverage-report/
reporter: [['html'], ['playwright-ui-coverage/reporter']],

// 2. Inside the HTML report, served together by `npx playwright show-report`.
//    List the html reporter first: it clears its folder when it writes.
reporter: [['html'], ['playwright-ui-coverage/reporter', { outputFolder: 'playwright-report/ui-coverage' }]],
```

- **Test links** work from `file://` too.
- **Trace links** need the reports served over `http(s)`, like the HTML report's own trace links (the trace viewer can't load from `file://` and says so). With layout 2, `npx playwright show-report` serves both; with layout 1, serve the folder that contains both with any static file server.
- Traces are never sent anywhere: the link uses the HTML report's own copy of the trace viewer, not trace.playwright.dev.
- **`merge-reports`:** pass both reporters in a merge config (`--config merge.config.ts`). With `--reporter html,playwright-ui-coverage/reporter` on the command line the reporter can't see the HTML reporter's options, so there are no links.
- The trace viewer can't open at a given time or action from a URL, so links open the trace at its start.
- A [rebuild](./how-it-works.md#rebuilding-the-report) keeps the links and adjusts them to `--out`.

Each trace is identified by the file name the HTML reporter gives it (SHA-1 of its content), computed only when the HTML report is linked.

## Most repeated elements

Elements used by many tests are often setup steps (signing in, creating data) rather than what those tests check. **Most repeated elements** in the sidebar lists them with their number of tests and interactions; click a route to see the element on its page. In `coverage.json` they are in `insights.mostRepeated`.

If a step there isn't what most of those tests are about, you can do it once instead: [authenticate in a setup project and reuse the `storageState`](https://playwright.dev/docs/auth), or [prepare data through the API](https://playwright.dev/docs/api-testing#using-request-context), and keep one test that goes through the UI.

The element table also shows how many times each element was used (**Interactions**) and by how many tests (**Tests**); click either header to sort by it.
