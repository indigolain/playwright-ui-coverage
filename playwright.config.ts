import { defineConfig, devices } from '@playwright/test';

// Config for the bundled demo. In your own project, use
// `['playwright-ui-coverage/reporter', { ... }]` instead of the local path.
export default defineConfig({
  testDir: 'demo/tests',
  fullyParallel: true,
  reporter: [['list'], ['./src/reporter.ts', { outputFolder: 'ui-coverage-report' }]],
  use: {
    baseURL: 'http://localhost:4173',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node demo/server.mjs',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});
