import { defineConfig, devices } from '@playwright/test';
import { DEFAULT_INTERACTIONS, type UiCoverageOptions } from './src';
// Report-time rules, shared with the CLI: `npx playwright-ui-coverage report --config demo/ui-coverage.config.json`.
import uiCoverageRules from './demo/ui-coverage.config.json';

// Config for the bundled demo. In your own project, use
// `import 'playwright-ui-coverage/register'` and
// `['playwright-ui-coverage/reporter', { ... }]` instead of the local paths.
//
//   npm run demo           → fixture mode (tests use mergeTests(…, uiCoverage))
//   npm run demo:register  → register mode (no test changes, config import only)
if (process.env.UICOV_MODE === 'register') require('./src/register');

// PORT lets several checkouts run the demo at the same time.
const port = Number(process.env.PORT || 4173);

// UICOV_DEMO_THRESHOLDS shows per-view thresholds: `pass` → a config the demo meets,
// `1`/`fail` → one it doesn't (exit code 1), plus a typo'd view that only warns.
const demoThresholds =
  process.env.UICOV_DEMO_THRESHOLDS === 'pass'
    ? { overall: 30, views: { '/users': 40, '/users/*': 15 } }
    : process.env.UICOV_DEMO_THRESHOLDS
      ? { overall: 30, views: { '/users': 40, '/settings': 50, '/users/*': 20, '/setings': 10 } }
      : undefined;

// UICOV_DEMO_LEGACY=1 sets the rules the deprecated way (use.uiCoverage) instead
// of in the reporter options; the report must be the same (scripts/check-rebuild.mjs).
const legacyRules = !!process.env.UICOV_DEMO_LEGACY;

export default defineConfig<{ uiCoverage: Partial<UiCoverageOptions> }>({
  testDir: 'demo/tests',
  fullyParallel: true,
  reporter: [
    ['list'],
    // Playwright's HTML report: "Tested by" in the UI coverage report links to it.
    ['html', { open: 'never' }],
    // UICOV_COUNT_FAILED=1 lets failed tests' interactions count (see demo/tests/failing.spec.ts).
    ['./src/reporter.ts', {
      outputFolder: 'ui-coverage-report',
      ...(legacyRules ? {} : uiCoverageRules),
      countFailedTests: !!process.env.UICOV_COUNT_FAILED,
      threshold: demoThresholds,
    }],
  ],
  use: {
    baseURL: `http://localhost:${port}`,
    // UICOV_TRACE=1 records traces, which the UI coverage report links to.
    trace: process.env.UICOV_TRACE ? 'on' : 'off',
    // Recording options (read by both the fixture and register mode).
    uiCoverage: {
      // Rules (identity, filters) are report-time options: demo/ui-coverage.config.json,
      // passed to the reporter above. UICOV_DEMO_LEGACY=1 sets them here instead (deprecated).
      ...(legacyRules ? uiCoverageRules : {}),
      // UICOV_FORMAT=jpeg records JPEG screenshots instead of PNG.
      ...(process.env.UICOV_FORMAT === 'jpeg' ? { format: 'jpeg' as const } : {}),
      // On /widgets, "Double-click to rename" only counts when double-clicked.
      allowedInteractions: [{ selector: '[data-testid="rename"]', events: ['dblclick'] }],
      // scroll is opt-in; the demo turns it on to show the scrollable log on /widgets.
      interactions: [...DEFAULT_INTERACTIONS, 'scroll'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `PORT=${port} node demo/server.mjs`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
