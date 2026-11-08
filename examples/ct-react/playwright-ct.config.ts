import { defineConfig, devices } from '@playwright/experimental-ct-react';
import type { UiCoverageOptions } from 'playwright-ui-coverage';

// Component testing example for playwright-ui-coverage.
//
//   npm test                → fixture mode (tests/fixtures.ts merges `uiCoverage` into the CT `test`)
//   npm run test:register   → register mode (config import only, specs use the CT `test` as-is)
if (process.env.UICOV_MODE === 'register') await import('playwright-ui-coverage/register');

// The Vite dev server that serves components. CT_PORT lets several checkouts run at once.
const ctPort = Number(process.env.CT_PORT || 4210);

export default defineConfig<{ uiCoverage: Partial<UiCoverageOptions> }>({
  testDir: './tests',
  fullyParallel: true,
  reporter: [
    ['list'],
    // Every component test loads the same URL, so the reporter groups views by
    // spec file. `viewBy: 'file'` is what it picks for CT anyway; it's set here for clarity.
    ['playwright-ui-coverage/reporter', { outputFolder: 'ui-coverage-report', viewBy: 'file' }],
  ],
  use: {
    ctPort,
    uiCoverage: {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
