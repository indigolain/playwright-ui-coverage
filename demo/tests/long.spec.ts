import { test, expect } from '../fixtures';

// A long scrolling page: the header and the chat button are `position: fixed`,
// the sidebar is `position: sticky`. Screenshots are taken while the page is
// scrolled (the feedback button reveals an "Undo" button at the top of the page,
// outside the viewport, which gets a full-page screenshot), so the overlays show
// fixed/sticky elements where they were on screen. The chat panel is opened and
// closed again within a few ms: a short-lived state, screenshotted when the
// viewport capture wins the race (captureTransientStates).

test('scroll down, use the sticky sidebar and the chat', async ({ page }) => {
  await page.goto('/long');
  await page.getByTestId('feedback').click(); // scrolls to the bottom
  await expect(page.getByTestId('feedback')).toHaveText('Thanks!');
  await page.getByRole('button', { name: 'Print' }).click();
  await page.getByTestId('chat').click();
  await page.getByLabel('Message').fill('Hello');
  await page.getByTestId('chat-send').click();
  await expect(page.getByLabel('Message')).toBeHidden();
});
