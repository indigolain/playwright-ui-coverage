import { defineConfig, devices, type ReporterDescription } from '@playwright/test';
import { DEFAULT_INTERACTIONS, type UiCoverageOptions } from './src';

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

// BROWSER=firefox|webkit runs the demo in another engine (CI runs all three).
const browser = process.env.BROWSER || 'chromium';
const deviceFor: Record<string, string> = {
  chromium: 'Desktop Chrome',
  firefox: 'Desktop Firefox',
  webkit: 'Desktop Safari',
};
const device = deviceFor[browser];
if (!device) throw new Error(`Unknown BROWSER "${browser}" (use chromium, firefox or webkit)`);

const reporter: ReporterDescription[] = [
  ['list'],
  // UICOV_COUNT_FAILED=1 lets failed tests' interactions count (see demo/tests/failing.spec.ts).
  ['./src/reporter.ts', {
    outputFolder: 'ui-coverage-report',
    countFailedTests: !!process.env.UICOV_COUNT_FAILED,
    threshold: demoThresholds,
  }],
];
// CI checks that recording adds no steps to the user's report.
if (process.env.UICOV_CHECK_STEPS) reporter.push(['./scripts/no-steps-reporter.js']);

export default defineConfig<{ uiCoverage: Partial<UiCoverageOptions> }>({
  testDir: 'demo/tests',
  fullyParallel: true,
  reporter,
  use: {
    baseURL: `http://localhost:${port}`,
    // Recording options (read by both the fixture and register mode).
    uiCoverage: {
      // Delete buttons on /users carry data-action; use it as their identity.
      significantAttributes: ['data-action'],
      // UICOV_FORMAT=jpeg records JPEG screenshots instead of PNG.
      ...(process.env.UICOV_FORMAT === 'jpeg' ? { format: 'jpeg' as const } : {}),
      // On /widgets, "Double-click to rename" only counts when double-clicked.
      allowedInteractions: [{ selector: '[data-testid="rename"]', events: ['dblclick'] }],
      // scroll is opt-in; the demo turns it on to show the scrollable log on /widgets.
      interactions: [...DEFAULT_INTERACTIONS, 'scroll'],
    },
  },
  projects: [{ name: browser, use: { ...devices[device] } }],
  webServer: {
    command: `PORT=${port} node demo/server.mjs`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
