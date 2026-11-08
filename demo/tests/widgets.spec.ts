import { test, expect } from '../fixtures';

// Exercises the interactivity rules and the extra interaction types on /widgets.
// Deliberately partial: "Share", "Restored action", "Back home" and the details summary stay untested.

test('role button, focusable card and nested widgets', async ({ page }) => {
  await page.goto('/widgets');
  const fake = page.getByTestId('fake-button');
  await fake.focus();
  await page.keyboard.press('Enter'); // keyboard activation
  await expect(fake).toHaveText('Clicked');
  await page.getByTestId('plain-card').click();
  await expect(page.getByTestId('plain-card')).toContainText('opened');
  await page.getByRole('checkbox', { name: 'Star' }).check();
  await page.getByTestId('article-like').click();
  await page.getByTestId('custom-tile').click();
  await expect(page.getByTestId('custom-tile')).toHaveText('Tile picked');
});

test('double-click, scroll and drag and drop', async ({ page }) => {
  await page.goto('/widgets');
  const rename = page.getByTestId('rename');
  await rename.click(); // doesn't count: only dblclick is allowed for it
  await rename.dblclick();
  await expect(rename).toHaveText('Renamed');

  // Retried: a wheel event can get lost while a full-page screenshot resizes the
  // viewport (seen with Chromium in Playwright 1.50).
  await expect(async () => {
    await page.getByTestId('log').hover();
    await page.mouse.wheel(0, 60);
    expect(await page.getByTestId('log').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  }).toPass({ timeout: 10_000 });

  await page.getByTestId('chip').dragTo(page.getByTestId('drop-zone'));
  await expect(page.getByTestId('drop-zone')).toHaveText('Dropped!');
});
