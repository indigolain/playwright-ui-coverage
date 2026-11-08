import { test, expect } from '../../src';

test('search filters the list', async ({ page }) => {
  await page.goto('/users');
  await page.getByLabel('Search users').fill('grace');
  await expect(page.getByRole('link', { name: 'Grace Hopper' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ada Lovelace' })).toBeHidden();
});

test('add a user via the modal', async ({ page }) => {
  await page.goto('/users');
  await page.getByRole('button', { name: 'Add user' }).click();
  await page.getByLabel('Name').fill('Katherine Johnson');
  await page.getByLabel('Role').selectOption('Admin');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('dialog')).toBeHidden();
});

test('open a user and go back', async ({ page }) => {
  await page.goto('/users');
  await page.getByRole('link', { name: 'Ada Lovelace' }).click();
  await expect(page.getByRole('heading', { name: 'User #1' })).toBeVisible();
  await page.getByRole('link', { name: '← Back to users' }).click();
  await expect(page).toHaveURL(/\/users$/);
});
