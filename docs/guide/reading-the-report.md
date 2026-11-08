# Reading the report

This page walks through the HTML report (`ui-coverage-report/index.html`): what the sidebar, screenshots and tables show, and how to use them to find and close gaps.

## Views and coverage

The sidebar lists every **view** (a page of your app) with its coverage. Dynamic URL segments are grouped automatically (`/users/1`, `/users/2` → `/users/:id`); [Views](./views.md) explains how to name views yourself.

Each view shows up to three screenshots (`maxScreenshotsPerRoute`), chosen to show the most elements, with every interactive element outlined:

- **green**: a test interacted with it;
- **red**: no test did;
- **amber** (*failing tests only*): only tests that never passed touched it. It counts as untested, see [Retries and failed tests](./retries.md).

![UI coverage report: route list with coverage %, a screenshot of the /users page with green boxes on tested elements and red boxes on untested ones](../images/report-overview.png)

Boxes of `position: fixed` and `sticky` elements are drawn dashed, see [Screenshots](./screenshots.md#fixed-and-sticky-elements). Screenshots of short-lived states (a modal a test opened and closed quickly) are captioned "viewport, right after an interaction".

## Find what's missing

Turn on **Untested only** to hide everything that's already covered:

![Settings page with only the untested elements outlined in red: theme select, bio textarea, reset and delete account buttons, nav links](../images/report-untested-only.png)

## See where each element is, and which tests cover it

Below the screenshots, the element table lists each element with its status, label and the tests that covered it ("Tested by"). Hover a row to highlight that element on the screenshot; click an element's box on the screenshot to jump to its row.

Repeated elements, such as a "Delete" button on every row, are grouped into one entry, `label (N instances)`, see [Element grouping](./element-grouping.md):

![Hovering the 'button Delete (3 instances)' row outlines all three Delete buttons on the screenshot in orange; the table lists each element with its status and the tests that covered it](../images/report-hover.png)

The tooltip of the *tested* label and of the **Interactions** cell shows the interactions that counted, by type (`click: 3, input: 1`).

## Links and untested views

Each view also has a **Links** table: its links grouped by destination view, with the `<a>` elements that point there (*Referrers*) and the URLs. Views that no test visited at all are listed under **Untested views** in the sidebar. See [Links and untested views](./links.md).

![The Links table of /settings: an untested link to /settings/audit with its suggested locator, tested links to / and /users, and /settings/audit under "Untested views" in the sidebar](../images/report-links.png)

## Write the missing tests

Each untested element has a ready-to-paste Playwright line with a *Copy* button, and *Copy untested as test skeleton* gives you a whole test for the view. Elements also get small, informational **accessibility hints** (in blue), such as a control without an accessible name. See [Suggested locators and accessibility hints](./locators-and-accessibility.md).

![The /users/:id table: each untested element has a suggested locator such as await page.getByRole('button', { name: 'Edit' }).click(); with a Copy button, and blue accessibility hints such as 'No accessible name' under some elements](../images/report-locators.png)

## Jump to the test and its trace

With Playwright's HTML reporter configured, each test under "Tested by" links to its entry in the HTML report, and to its trace when one was recorded. See [Insights and the HTML report](./insights.md#links-to-the-html-report-and-traces).

## Spot repeated setup

The element table shows how many times each element was used (**Interactions**) and by how many tests (**Tests**); click either header to sort by it. **Most repeated elements** in the sidebar lists the elements used by the most tests across the report, such as a login form that every test fills in first. See [Insights](./insights.md#most-repeated-elements).

## Large suites

Filter views by name (press `/`), and sort them by name, lowest coverage or most untested elements. Screenshots load lazily. A synthetic report with 300 routes × 80 elements opens in about 0.1 s, and switching routes takes a few milliseconds (`npm run perf` in this repository measures it).

## Dark mode

The report follows your system's light or dark setting:

![The report in dark mode showing the home page](../images/report-dark.png)

## Next to the report

The report folder also has:

- `coverage.json`: the same results, machine-readable, for CI gates and dashboards. See [coverage.json](../coverage-json.md).
- `data/`: the raw recordings and every screenshot, used to [rebuild the report](../reference/cli.md#report) with other rules.
