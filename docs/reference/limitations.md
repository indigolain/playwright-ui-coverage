# Known limitations

This page collects what the library can't do, or does only partly, so you can tell a gap in the report from a limit of the tool.

## Recording

- **Hover-only interactions aren't counted.**
- **Scroll containers:** with `scroll` enabled, Playwright's automatic scrolling-into-view before actions also counts as a `scroll` of the container. That's why `scroll` is off by default, see [Interaction types](../guide/which-elements-count.md#interaction-types).
- **Clickable elements with no role, `tabindex` or `data-uicov-interactive`** (only a JS click handler) aren't recorded at all. Mark them with `data-uicov-interactive="include"`, or better, give them a role and `tabindex`.
- **Closed shadow roots** aren't inventoried: only their host can count (see [Iframes and shadow DOM](../guide/iframes-shadow-dom.md#closed-shadow-roots)).
- **The deprecated recording-time `use.uiCoverage.ignoreSelectors`** doesn't reach into frames from the parent page (`iframe.ads button`); use the report-time `elementFilters` (`documentScope`), which do.

## Screenshots

- **Very short-lived UI states:** a state that lasts only a few milliseconds (shorter than a viewport screenshot takes, e.g. a panel a test opens and closes with no step in between) still counts its elements, but may not get a screenshot: the recorder only keeps a screenshot if the new elements are still there, unchanged, after it was taken. States whose new elements are outside the viewport wait for `snapshotDelay` as before. See [Short-lived states](../guide/screenshots.md#short-lived-states).
- **Cross-origin iframes** can run in their own process, and Chromium paints those in full-page screenshots only where they are inside the viewport. So elements of a cross-origin frame that are outside the viewport when a screenshot is taken still count, but get no box in it (a later screenshot taken while they are in view shows them).
- **Step screenshots** show the page after the step, unless the DOM event reached the recorder only after the test's next action had started; then the two steps share the screenshot after the second. A test's last step may have no screenshot if the test ends right after it.
- **Step calls** are matched to DOM events by time, using Playwright's private client instrumentation. If the instrumentation changes, or the browser's clock differs from the test runner's (a remote browser), steps are recorded without calls.
- **Fixed elements below the crop:** with `maxScreenshotHeight`, a page scrolled below the crop has its fixed elements (a fixed header) painted below the crop too, so they aren't drawn on that screenshot.

## Report time

- **Report-time selectors** don't support sibling combinators, `:has()`, `:nth-child()` or state pseudo-classes, because the data they need isn't recorded. See [Report-time selectors](../guide/rules.md#report-time-selectors).
- **A rebuild can't change what was recorded:** which elements are interactive, interaction types and screenshots. See [Rebuilding the report](../guide/how-it-works.md#rebuilding-the-report).
- **Grouping heuristics** can merge two unrelated controls with identical names and markup, and miss repeated controls whose names change per item. See [Element grouping](../guide/element-grouping.md#the-heuristics-are-conservative).

## Suggestions and hints

- **Suggested locators** are a starting point: elements inside a closed dialog or menu need the steps that open it first, and a name with per-run text that a run saw only once can't be detected as changing.
- **Accessibility hints** are an approximation, not an audit. See [what they can't see](../guide/locators-and-accessibility.md#accessibility-hints).

## Links to traces

The trace viewer can't open at a given time or action from a URL, so trace links open the trace at its start. They also need the reports served over `http(s)`. See [Links to the HTML report and traces](../guide/insights.md#links-to-the-html-report-and-traces).
