import { defineConfig, devices, type ReporterDescription } from '@playwright/test';

// Config for the bundled demo. In your own project, use
// `import 'playwright-ui-coverage/register'` and
// `['playwright-ui-coverage/reporter', { ... }]` instead of the local paths.
//
//   npm run demo           → fixture mode (tests use mergeTests(…, uiCoverage))
//   npm run demo:register  → register mode (no test changes, config import only)
if (process.env.UICOV_MODE === 'register') require('./src/register');

// PORT lets several checkouts run the demo at the same time.
const port = Number(process.env.PORT || 4173);

// BROWSER=firefox|webkit runs the demo in another engine (CI runs all three).
const browser = process.env.BROWSER || 'chromium';
const deviceFor: Record<string, string> = {
  chromium: 'Desktop Chrome',
  firefox: 'Desktop Firefox',
  webkit: 'Desktop Safari',
};
const device = deviceFor[browser];
if (!device) throw new Error(`Unknown BROWSER "${browser}" (use chromium, firefox or webkit)`);

const reporter: ReporterDescription[] = [['list'], ['./src/reporter.ts', { outputFolder: 'ui-coverage-report' }]];
// CI checks that recording adds no steps to the user's report.
if (process.env.UICOV_CHECK_STEPS) reporter.push(['./scripts/no-steps-reporter.js']);

export default defineConfig({
  testDir: 'demo/tests',
  fullyParallel: true,
  reporter,
  use: {
    baseURL: `http://localhost:${port}`,
  },
  projects: [{ name: browser, use: { ...devices[device] } }],
  webServer: {
    command: `PORT=${port} node demo/server.mjs`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
