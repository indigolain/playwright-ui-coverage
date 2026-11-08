// Regenerates the documentation screenshots in docs/images/ from ui-coverage-report/.
// Run `npm run demo` first, then `npm run docs:screenshots`.
import { chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = pathToFileURL(path.join(root, 'ui-coverage-report', 'index.html')).href;
const out = path.join(root, 'docs', 'images');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2, colorScheme: 'light' });
const open = async (route) => {
  await page.goto(`${report}#${encodeURIComponent(route)}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('.shot img').first().evaluate((img) => img.decode?.());
  await page.locator('.box').first().waitFor();
};

// 1. Overview: route list + screenshot with overlays.
await open('/users');
await page.screenshot({ path: path.join(out, 'report-overview.png') });

// 2. Hovering a table row highlights the element on the screenshot.
await page.locator('tr[data-key="[data-action=\\"delete-user\\"]"]').hover();
// A full-page capture would paint the sticky header at the scroll position, mid-image.
await page.locator('header').evaluate((h) => (h.style.position = 'static'));
await page.screenshot({ path: path.join(out, 'report-hover.png'), fullPage: true });

// 3. "Untested only" on the settings page.
await open('/settings');
await page.getByLabel('Untested only').check();
await page.screenshot({ path: path.join(out, 'report-untested-only.png') });

// 4. Suggested locators and accessibility hints in the table.
await open('/users/:id');
await page.getByLabel('Untested only').check();
await page.mouse.move(0, 0);
// The sticky header would cover the top of an element screenshot.
await page.locator('header').evaluate((h) => (h.style.position = 'static'));
await page.locator('.table-wrap').first().screenshot({ path: path.join(out, 'report-locators.png') });

// 5. Links of /settings by destination, with the untested view in the sidebar.
await open('/settings');
await page.mouse.move(0, 0);
await page.locator('h2.section').evaluate((h) => h.scrollIntoView({ block: 'start' }));
await page.screenshot({ path: path.join(out, 'report-links.png') });

// 6. Dark mode.
await page.emulateMedia({ colorScheme: 'dark' });
await open('/');
await page.screenshot({ path: path.join(out, 'report-dark.png') });

await browser.close();
console.log('Wrote screenshots to docs/images/');
