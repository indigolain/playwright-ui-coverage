---
layout: home

hero:
  name: playwright-ui-coverage
  text: UI coverage for Playwright tests
  tagline: See which buttons, links and inputs your E2E tests actually touch, on screenshots of your app with green (tested) and red (untested) overlays.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: What is UI coverage?
      link: /guide/introduction
    - theme: alt
      text: GitHub
      link: https://github.com/indigolain/playwright-ui-coverage

features:
  - title: Every page, every control
    details: Each page your tests visit, with every interactive element marked tested or untested, a coverage % per view, and the tests that covered each element.
    link: /guide/reading-the-report
  - title: One config line to try it
    details: Import playwright-ui-coverage/register in playwright.config.ts, or merge the uiCoverage fixture. No changes to your tests either way.
    link: /guide/getting-started
  - title: Write the missing tests faster
    details: A ready-to-paste Playwright locator for every untested element, a test skeleton per view, and informational accessibility hints.
    link: /guide/locators-and-accessibility
  - title: Stable element identity
    details: Elements are matched by attributes and position, never by visible text, so copy changes and translations don't create new elements.
    link: /guide/element-identity
  - title: Gates for CI
    details: Thresholds per view, a baseline that fails only on new gaps, run-to-run comparison and sticky PR comments.
    link: /ci/baseline
  - title: Change the rules, not the run
    details: Filters, views and identity rules are applied when the report is built. Rebuild the report from stored data without running the tests again.
    link: /guide/how-it-works
---

<div class="home-shot">

![The UI coverage report: a route list with coverage % per view, and a screenshot of the /users page with green boxes on tested elements and red boxes on untested ones](./images/report-overview.png)

</div>
