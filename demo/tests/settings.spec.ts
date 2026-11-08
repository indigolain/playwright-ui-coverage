import { test, expect } from '../fixtures';

// Deliberately partial: theme, bio, reset and "Delete account" stay untested.
test('enable notifications', async ({ page }) => {
  await page.goto('/settings');
  await page.getByLabel('Display name').fill('Ada');
  // UICOV_DEMO_GAP=1 skips this step, a new untested element for the baseline check (scripts/check-baseline.mjs).
  if (!process.env.UICOV_DEMO_GAP) await page.getByLabel('Email notifications').check();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
});
