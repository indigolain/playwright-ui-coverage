// UI coverage config for the bundled demo, found automatically next to
// playwright.config.ts by the recorder, the reporter and the `report` CLI.
// In your own project, import from 'playwright-ui-coverage' (or
// 'playwright-ui-coverage/config') instead of the local paths.
import { defineUiCoverageConfig } from './src/config';
import { DEFAULT_INTERACTIONS } from './src/interactions';

export default defineUiCoverageConfig({
  // Report-time rules: change them and rebuild with `npx playwright-ui-coverage report`.
  significantAttributes: ['data-action'],

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
