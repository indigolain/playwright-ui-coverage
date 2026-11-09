import { defineConfig, devices, type ReporterDescription } from '@playwright/test';
import type { UiCoverageOptions } from './src';
// The demo's UI coverage config (rules, recording options, profiles). The
// recorder, the reporter and `npx playwright-ui-coverage report` find it
// next to this file; it's imported here only for UICOV_DEMO_LEGACY below.
import uiCoverageConfig, { demoReportRules } from './ui-coverage.config';

// Config for the bundled demo. In your own project, use
// `import 'playwright-ui-coverage/register'` and
// `['playwright-ui-coverage/reporter']` instead of the local paths.
//
//   npm run demo           → fixture mode (tests use mergeTests(…, uiCoverage))
//   npm run demo:register  → register mode (no test changes, config import only)
if (process.env.UICOV_MODE === 'register') require('./src/register');

// PORT lets several checkouts run the demo at the same time.
const port = Number(process.env.PORT || 4173);

// UICOV_DEMO_LEGACY=1 sets everything the old way: rules and recording options
// in use.uiCoverage (the rules there are deprecated) and no config file. The
// report must be the same (scripts/check-rebuild.mjs).
const legacy = !!process.env.UICOV_DEMO_LEGACY;

// UICOV_DEMO_BASELINE=check|update turns on baseline mode (scripts/check-baseline.mjs):
// the baseline is UICOV_DEMO_BASELINE_FILE, default demo/ui-coverage-baseline.json (gitignored).
const demoBaseline = process.env.UICOV_DEMO_BASELINE
  ? {
      file: process.env.UICOV_DEMO_BASELINE_FILE || 'demo/ui-coverage-baseline.json',
      mode: process.env.UICOV_DEMO_BASELINE as 'check' | 'update',
    }
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
  // Playwright's HTML report: "Tested by" in the UI coverage report links to it.
  ['html', { open: 'never' }],
  // Reporter options are optional: the config file holds the settings. Keys
  // set here win over the file (UICOV_COUNT_FAILED=1 lets failed tests'
  // interactions count, see demo/tests/failing.spec.ts).
  ['./src/reporter.ts', {
    // Without a config file, the rules that can't go in use.uiCoverage go here.
    ...(legacy ? { configFile: false, ...demoReportRules } : {}),
    ...(process.env.UICOV_COUNT_FAILED ? { countFailedTests: true } : {}),
    ...(demoBaseline ? { baseline: demoBaseline } : {}),
    // UICOV_DEMO_SUMMARY=1 appends a markdown summary to $GITHUB_STEP_SUMMARY (when set).
    ...(process.env.UICOV_DEMO_SUMMARY ? { githubSummary: true } : {}),
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
    // UICOV_TRACE=1 records traces, which the UI coverage report links to.
    trace: process.env.UICOV_TRACE ? 'on' : 'off',
    // Recording options here win over `recording` in ui-coverage.config.ts, key by key.
    uiCoverage: {
      // UICOV_OFF=1 turns recording off, e.g. to check whether a flaky test is flaky without it.
      ...(process.env.UICOV_OFF ? { enabled: false } : {}),
      ...(legacy ? { significantAttributes: uiCoverageConfig.significantAttributes, ...uiCoverageConfig.recording } : {}),
      // UICOV_FORMAT=jpeg records JPEG screenshots instead of PNG.
      ...(process.env.UICOV_FORMAT === 'jpeg' ? { format: 'jpeg' as const } : {}),
      // UICOV_STEPS=off records no steps (no state stepper beyond the regular screenshots).
      ...(process.env.UICOV_STEPS === 'off' ? { steps: 'off' as const } : {}),
    },
  },
  projects: [{ name: browser, use: { ...devices[device] } }],
  webServer: {
    command: `PORT=${port} node demo/server.mjs`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
