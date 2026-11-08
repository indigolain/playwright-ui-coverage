import { test, expect } from '../fixtures';

// Elements in an open shadow root and in iframes (same- and cross-origin) on /embedded.
// Deliberately partial: "Dismiss", the promo link, the help FAQ and links, "Expiry"
// and "Mastercard" stay untested.

test('web components: open shadow root, closed shadow root host', async ({ page }) => {
  await page.goto('/embedded');
  await page.getByRole('button', { name: 'Claim offer' }).click(); // getByRole pierces open shadow roots
  await expect(page.getByText('Claimed!')).toBeVisible();
  await page.getByPlaceholder('you@example.com').fill('ann@example.com');
  await page.getByPlaceholder('you@example.com').blur(); // `change` stays inside the shadow root
  await expect(page.getByText("We'll write to ann@example.com")).toBeVisible();
  await page.getByTestId('closed-toggle').click();
});

test('same-origin iframe', async ({ page }) => {
  await page.goto('/embedded');
  const help = page.frameLocator('[data-testid="help"]');
  await help.getByTestId('helpful').click();
  await expect(help.getByTestId('helpful')).toHaveText('Thanks!');
});

test('cross-origin iframe with a web component inside', async ({ page }) => {
  await page.goto('/embedded');
  const payments = page.frameLocator('[data-testid="payments"]');
  await payments.getByTestId('card').fill('4242 4242 4242 4242');
  await payments.getByRole('radio', { name: 'Visa' }).click();
  await payments.getByTestId('pay').click();
  await expect(payments.getByText('Paid')).toBeVisible();
});
