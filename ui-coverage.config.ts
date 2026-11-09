// UI coverage config for the bundled demo, found automatically next to
// playwright.config.ts by the recorder, the reporter and the `report` CLI.
// In your own project, import from 'playwright-ui-coverage' (or
// 'playwright-ui-coverage/config') instead of the local paths.
import { defineUiCoverageConfig } from './src/config';
import { DEFAULT_INTERACTIONS } from './src/interactions';

/**
 * Views and element rules. None of them changes the demo's numbers: the
 * footer links were excluded in the markup before, the Playwright link is only
 * shown by a test that is skipped, and the view pattern names the view the
 * automatic rules would.
 */
export const demoReportRules = defineUiCoverageConfig({
  views: [{ pattern: '/users/:id', comment: 'Every user page is one view, whatever the id (/users/ada too).' }],
  viewFilters: [
    {
      pattern: 'https://playwright.dev/*',
      include: false,
      comment: 'An external site the home page links to: links to it are dropped (not counted as elements).',
    },
  ],
  elementFilters: [
    {
      selector: 'footer *',
      include: false,
      comment: 'The legal links in the home page footer. `footer` alone would match only the footer element itself.',
    },
  ],
  elements: [
    {
      selector: 'main > div:nth-of-type(2) > button',
      name: 'Star user (icon button)',
      comment: 'The icon-only button on /users/:id has no accessible name; give it one in the report.',
    },
  ],
});

export default defineUiCoverageConfig({
  // Report-time rules: change them and rebuild with `npx playwright-ui-coverage report`.
  // (UICOV_DEMO_LEGACY=1 passes these to the reporter inline, see playwright.config.ts.)
  significantAttributes: ['data-action'],
  ...demoReportRules,

  // Recording options (read by both the fixture and register mode).
  recording: {
    allowedInteractions: [
      {
        selector: '[data-testid="rename"]',
        events: ['dblclick'],
        comment: 'On /widgets, "Double-click to rename" only counts when double-clicked.',
      },
    ],
    // scroll is opt-in; the demo turns it on to show the scrollable log on /widgets.
    interactions: [...DEFAULT_INTERACTIONS, 'scroll'],
    // Steps are opt-in too: the report's state stepper then has a screenshot after every step.
    steps: 'on',
  },

  // Per-view thresholds: UI_COVERAGE_PROFILE=thresholds-pass npm run demo (or thresholds-fail).
  profiles: [
    {
      name: 'thresholds-pass',
      comment: 'Thresholds the demo meets.',
      config: { threshold: { overall: 30, views: { '/users': 40, '/users/*': 15 } } },
    },
    {
      name: 'thresholds-fail',
      comment: 'Thresholds the demo misses (exit code 1), plus a typo\'d view that only warns.',
      config: { threshold: { overall: 30, views: { '/users': 40, '/settings': 50, '/users/*': 40, '/setings': 10 } } },
    },
  ],
});
