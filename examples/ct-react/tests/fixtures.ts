import { test as ctTest, expect } from '@playwright/experimental-ct-react';
import { mergeTests } from '@playwright/test';
import { uiCoverage } from 'playwright-ui-coverage';

// Fixture mode: merge `uiCoverage` into the CT `test` (which provides `mount`).
// Register mode (UICOV_MODE=register) uses the CT `test` as it is: the config
// import does the recording.
export const test = process.env.UICOV_MODE === 'register' ? ctTest : mergeTests(ctTest, uiCoverage);
export { expect };
