import { test, expect } from '../fixtures';

// Deliberately partial: theme, bio, reset and "Delete account" stay untested.
test('enable notifications', async ({ page }) => {
  await page.goto('/settings');
  await page.getByLabel('Display name').fill('Ada');
  await page.getByLabel('Email notifications').check();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
});
