import { test as base, expect, mergeTests } from '@playwright/test';
import { uiCoverage } from '../src';

// Stand-in for a project's own fixtures.
const appTest = base.extend<{ appName: string }>({
  appName: 'Acme',
});

// Fixture mode composes uiCoverage in with mergeTests. Register mode
// (UICOV_MODE=register) uses the plain fixtures: the config import does the recording.
export const test = process.env.UICOV_MODE === 'register' ? appTest : mergeTests(appTest, uiCoverage);
export { expect };
