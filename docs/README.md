# playwright-ui-coverage documentation

These are the sources of the documentation site, https://indigolain.github.io/playwright-ui-coverage/. The pages read fine on GitHub too:

**Introduction**

- [What is UI coverage?](guide/introduction.md)
- [Getting started](guide/getting-started.md)

**Guides**

- [Reading the report](guide/reading-the-report.md)
- [How it works](guide/how-it-works.md)
- [Which elements count](guide/which-elements-count.md) (and interaction types)
- [Element identity](guide/element-identity.md)
- [Element grouping](guide/element-grouping.md)
- [Links and untested views](guide/links.md)
- [Views](guide/views.md)
- [Report-time rules](guide/rules.md)
- [Screenshots](guide/screenshots.md)
- [Iframes and shadow DOM](guide/iframes-shadow-dom.md)
- [Retries and failed tests](guide/retries.md)
- [Sharding and merge-reports](guide/sharding.md)
- [Component testing](guide/component-testing.md)
- [Suggested locators and accessibility hints](guide/locators-and-accessibility.md)
- [Insights and the HTML report](guide/insights.md)

**CI**

- [Thresholds](ci/thresholds.md)
- [Baseline (ratchet)](ci/baseline.md)
- [Comparing runs and PR comments](ci/compare.md)
- [GitHub Actions workflow](github-actions.md)

**Reference**

- [Configuration file](reference/configuration.md)
- [Recording options](reference/recording-options.md)
- [Reporter options](reference/settings.md)
- [CLI](reference/cli.md)
- [coverage.json](coverage-json.md)
- [Raw data format](reference/raw-data.md)
- [Compatibility](reference/compatibility.md)
- [Known limitations](reference/limitations.md)
- [Contributing](reference/contributing.md)

To build the site locally: `npm run docs:dev` (see [Contributing](reference/contributing.md#documentation)).
