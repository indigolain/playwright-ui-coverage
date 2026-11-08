import { defineConfig, devices } from '@playwright/test';

// Config for the bundled demo. In your own project, use
// `import 'playwright-ui-coverage/register'` and
// `['playwright-ui-coverage/reporter', { ... }]` instead of the local paths.
//
//   npm run demo           → fixture mode (tests use mergeTests(…, uiCoverage))
//   npm run demo:register  → register mode (no test changes, config import only)
if (process.env.UICOV_MODE === 'register') require('./src/register');

// PORT lets several checkouts run the demo at the same time.
const port = Number(process.env.PORT || 4173);

export default defineConfig({
  testDir: 'demo/tests',
  fullyParallel: true,
  reporter: [['list'], ['./src/reporter.ts', { outputFolder: 'ui-coverage-report' }]],
  use: {
    baseURL: `http://localhost:${port}`,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `PORT=${port} node demo/server.mjs`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
