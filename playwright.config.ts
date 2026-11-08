import { defineConfig, devices } from '@playwright/test';
import type { UiCoverageOptions } from './src';

// Config for the bundled demo. In your own project, use
// `import 'playwright-ui-coverage/register'` and
// `['playwright-ui-coverage/reporter', { ... }]` instead of the local paths.
//
//   npm run demo           → fixture mode (tests use mergeTests(…, uiCoverage))
//   npm run demo:register  → register mode (no test changes, config import only)
if (process.env.UICOV_MODE === 'register') require('./src/register');

// PORT lets several checkouts run the demo at the same time.
const port = Number(process.env.PORT || 4173);

export default defineConfig<{ uiCoverage: Partial<UiCoverageOptions> }>({
  testDir: 'demo/tests',
  fullyParallel: true,
  reporter: [
    ['list'],
    // UICOV_COUNT_FAILED=1 lets failed tests' interactions count (see demo/tests/failing.spec.ts).
    ['./src/reporter.ts', { outputFolder: 'ui-coverage-report', countFailedTests: !!process.env.UICOV_COUNT_FAILED }],
  ],
  use: {
    baseURL: `http://localhost:${port}`,
    // Recording options (read by both the fixture and register mode).
    uiCoverage: {
      // Delete buttons on /users carry data-action; use it as their identity.
      significantAttributes: ['data-action'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `PORT=${port} node demo/server.mjs`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
