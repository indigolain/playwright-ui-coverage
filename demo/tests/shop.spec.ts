import { test, expect } from '../fixtures';

// Element grouping on /shop (README "Element grouping"):
// - adding one product marks the "Add to cart" group (all 3 cards) tested;
// - "Save for later" (repeated too) stays untested, once, not 3 times;
// - one star marks the whole "star-rating" group (data-uicov-group) tested;
// - signing in tests the sign-in form only: the sign-up form's identically
//   attributed fields and submit button stay separate, untested elements;
// - the "Gift note" label is merged into its input, which the test fills.
test('add to cart, rate, sign in', async ({ page }) => {
  await page.goto('/shop');
  await page.getByTestId('add-to-cart-2').click();
  await expect(page.getByText('Cart: 1 items')).toBeVisible();
  await page.getByRole('button', { name: '4 stars' }).click();
  await expect(page.getByText('Thanks for 4 stars!')).toBeVisible();

  const signIn = page.locator('#signin');
  await signIn.getByLabel('Email').fill('ada@example.com');
  await signIn.getByLabel('Password').fill('secret');
  await signIn.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Welcome back!')).toBeVisible();

  await page.getByLabel('Gift note').fill('Happy birthday!');
});
