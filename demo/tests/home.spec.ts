import { test, expect } from '../fixtures';

test('subscribe to the newsletter', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByRole('button', { name: 'Subscribe' }).click();
  await expect(page.getByText('Thanks for subscribing!')).toBeVisible();
});

test('get started goes to users', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('get-started').click();
  await expect(page).toHaveURL(/\/users$/);
});
