# Screenshots

This page explains when screenshots are taken, the options that control their number, size and format, and how fixed elements and short-lived UI states are handled.

Screenshots only affect what the report draws: elements are counted in every mode, even with screenshots off.

## Options

Screenshot options are [recording options](../reference/recording-options.md), set in `recording` in the config file:

```ts
// ui-coverage.config.ts
import { defineUiCoverageConfig } from 'playwright-ui-coverage/config';

export default defineUiCoverageConfig({
  recording: {
    screenshots: 'first-only',
    format: 'jpeg',
    quality: 80,
    maxScreenshotHeight: 8000,
  },
  maxScreenshotsPerRoute: 3, // report time: screenshots shown per view
});
```

| Option | Default | Description |
|---|---|---|
| `screenshots` | `'on'` | `'on'`: screenshot whenever a page state shows elements no screenshot has shown yet. `'first-only'`: at most one screenshot per URL per test. `'off'`: no screenshots; the report shows the element tables only. Elements are counted in every mode. |
| `format` | `'png'` | `'jpeg'` files are usually several times smaller. |
| `quality` | `80` | JPEG quality, 0–100 (ignored for PNG). |
| `maxScreenshotHeight` | `8000` | Full-page screenshots of taller pages are cropped to this height (CSS px). Elements below the crop are still counted, just not drawn on the image. `0` disables the cap. |
| `captureTransientStates` | `true` | Screenshot short-lived states right away, see [below](#short-lived-states). Only with `screenshots: 'on'`. |
| `snapshotDelay` | `250` | ms to wait after an interaction before taking the inventory and screenshot. |

The reporter option `maxScreenshotsPerRoute` (default `3`) picks the screenshots that cover the most elements for each view. Every screenshot is kept in `ui-coverage-report/data/screenshots/` (unless `saveData: false`), so a [rebuild](./how-it-works.md#rebuilding-the-report) can choose differently.

## When screenshots are taken

When a page loads and shortly after interactions (`snapshotDelay`), the recorder takes an inventory of the visible interactive elements and a full-page screenshot, but only when the page shows elements no screenshot has shown yet.

In Chromium, full-page captures and the test's input calls take turns, because input sent while a full-page capture resizes the viewport can get lost. See [How it works](./how-it-works.md#1-recording-in-the-browser).

## Short-lived states

A modal that a test opens, fills and saves within `snapshotDelay` would never be photographed if the recorder only waited. With `captureTransientStates` (default on), when an interaction changes the page so that the viewport shows elements no screenshot has shown yet, the page sends an inventory as soon as its handlers have run, and the recorder takes a **viewport** screenshot immediately. The report captions these "viewport, right after an interaction".

It costs an extra inventory after interactions that change the DOM, and a viewport screenshot only when something new appeared (no measurable difference in the demo's run time).

Limits:

- A state that lasts only a few milliseconds (shorter than a viewport screenshot takes, e.g. a panel a test opens and closes with no step in between) still counts its elements, but may not get a screenshot: the recorder only keeps a screenshot if the new elements are still there, unchanged, after it was taken.
- States whose new elements are outside the viewport wait for `snapshotDelay` as before.

## Fixed and sticky elements

Boxes are recorded where elements were on screen (viewport position + scroll offset). Full-page screenshots in Chromium, Firefox and WebKit paint `position: fixed` and `sticky` elements (and modal dialogs) at that same place, at the scroll position the page had. So a fixed header shows up in the middle of a full-page image when the page was scrolled, and its box is drawn there. The report draws these boxes **dashed**.

If the page scrolls between the inventory and the screenshot, the boxes no longer match and the screenshot is retaken.

With `maxScreenshotHeight`, a page scrolled below the crop has its fixed elements (a fixed header) painted below the crop too, so they aren't drawn on that screenshot.

## Cross-origin iframes

Cross-origin iframes can run in their own process, and Chromium paints those in full-page screenshots only where they are inside the viewport. Elements of a cross-origin frame that are outside the viewport when a screenshot is taken still count, but get no box in it (a later screenshot taken while they are in view shows them). See [Iframes and shadow DOM](./iframes-shadow-dom.md).

## Screenshots as attachments

Each screenshot is a file attachment named `ui-coverage-screenshot-<n>`, next to the `ui-coverage` JSON attachment, so you'll see them listed under the test's attachments in Playwright's own HTML report. That's also how they travel with the `blob` reporter, see [Sharding and merge-reports](./sharding.md).
