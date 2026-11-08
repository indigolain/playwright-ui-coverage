import { test, expect } from '../fixtures';

// Shows how failed and retried tests count toward coverage. Skipped unless
// UICOV_DEMO_FAIL=1, so the normal demo stays green:
//
//   UICOV_DEMO_FAIL=1 npx playwright test --retries=1
test.skip(!process.env.UICOV_DEMO_FAIL, 'set UICOV_DEMO_FAIL=1 to run');

// Always fails after clicking "Reset": by default Reset is reported as
// "touched by failing tests only", not as tested.
test('reset settings (always fails)', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByText('Settings were reset.')).toBeVisible({ timeout: 500 });
});

// Fails on the first attempt and passes on retry (flaky). The passing attempt's
// interactions count, and the test is listed once under "Tested by".
test('learn more (flaky)', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Learn more' }).click();
  await expect(page.getByRole('link', { name: 'link to Playwright' })).toBeVisible();
  expect(testInfo.retry, 'fails on the first attempt on purpose').toBeGreaterThan(0);
});
