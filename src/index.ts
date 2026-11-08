import { test as base, expect } from '@playwright/test';
import { Recorder } from './recorder';

export interface UiCoverageOptions {
  /** Turn recording off (e.g. `enabled: !!process.env.UI_COVERAGE`). Default: true. */
  enabled: boolean;
  /** Extra selectors to exclude (elements inside `[data-uicov-ignore]` are always excluded). */
  ignoreSelectors: string[];
  /** ms to wait after a load/interaction before snapshotting. Default: 250. */
  snapshotDelay: number;
}

export const defaultUiCoverageOptions: UiCoverageOptions = {
  enabled: true,
  ignoreSelectors: [],
  snapshotDelay: 250,
};

/**
 * Drop-in replacement for Playwright's `test` that records UI coverage.
 *
 *   import { test, expect } from 'playwright-ui-coverage';
 *
 * Configure per project with `use: { uiCoverage: { ... } }`.
 */
export const test = base.extend<{ uiCoverage: Partial<UiCoverageOptions> }>({
  uiCoverage: [{}, { option: true }],
  page: async ({ page, uiCoverage }, use, testInfo) => {
    const options = { ...defaultUiCoverageOptions, ...uiCoverage };
    if (!options.enabled) {
      await use(page);
      return;
    }
    const recorder = new Recorder(page, testInfo, options);
    await recorder.install();
    await use(page);
    await recorder.finish();
  },
});

export { expect };
export type { TestCoverageData, Interaction, Snapshot, InventoryElement } from './types';
