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

test('like counter keeps its identity while its text changes', async ({ page }) => {
  await page.goto('/');
  const like = page.getByRole('button', { name: /Like/ });
  const before = Number(await page.locator('#likes').textContent());
  await like.click();
  await like.click();
  await expect(page.locator('#likes')).toHaveText(String(before + 2));
});
