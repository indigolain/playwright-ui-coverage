# Recording options

This page lists the options that decide what is captured while the tests run. They are read by both the fixture and register mode. Changing them needs a new test run; everything else can be changed with a [rebuild](../guide/how-it-works.md#rebuilding-the-report).

Set them in `recording` in the config file:

```ts
// ui-coverage.config.ts
import { DEFAULT_INTERACTIONS, defineUiCoverageConfig } from 'playwright-ui-coverage';

export default defineUiCoverageConfig({
  recording: {
    enabled: !!process.env.UI_COVERAGE, // default: true
    snapshotDelay: 250,                  // ms, default: 250
    captureTransientStates: true,        // default: true
    screenshots: 'on',                   // 'on' | 'first-only' | 'off', default: 'on'
    format: 'jpeg',                      // 'png' | 'jpeg', default: 'png'
    quality: 80,                         // JPEG quality 0-100, default: 80
    maxScreenshotHeight: 8000,           // CSS px, 0 = no cap, default: 8000
    interactions: [...DEFAULT_INTERACTIONS, 'focus'], // default: DEFAULT_INTERACTIONS
    allowedInteractions: [               // default: []
      { selector: '.date-picker input', events: ['change'], comment: "focusing or clicking it doesn't count" },
    ],
  },
});
```

## Options

| Option | Default | Description |
|---|---|---|
| `enabled` | `true` | Turn recording off, e.g. `enabled: !!process.env.UI_COVERAGE` to record only when a variable is set. |
| `snapshotDelay` | `250` | ms to wait after an interaction before taking the inventory and screenshot. |
| `captureTransientStates` | `true` | Take a viewport screenshot right after an interaction that shows new elements, see [Short-lived states](../guide/screenshots.md#short-lived-states). Only with `screenshots: 'on'`. |
| `screenshots` | `'on'` | `'on'`, `'first-only'` (at most one per URL per test) or `'off'`. Elements are counted in every mode. See [Screenshots](../guide/screenshots.md). |
| `format` | `'png'` | `'png'` or `'jpeg'` (usually several times smaller). |
| `quality` | `80` | JPEG quality, 0–100 (ignored for PNG). |
| `maxScreenshotHeight` | `8000` | Full-page screenshots of taller pages are cropped to this height (CSS px); `0` disables the cap. |
| `interactions` | `DEFAULT_INTERACTIONS` | The events that count, see [Interaction types](../guide/which-elements-count.md#interaction-types). Unknown names fail the run with the list of supported ones. |
| `allowedInteractions` | `[]` | `{ selector, events, comment? }` rules: for an element matching `selector` (the first matching rule wins), only `events` count, replacing `interactions`. The events listed here are recorded even if `interactions` leaves them out. |

`DEFAULT_INTERACTIONS` (every type except `scroll`, `focus` and `blur`) and `INTERACTION_TYPES` (all of them) are exported from `playwright-ui-coverage`. `defaultUiCoverageOptions` has all the defaults.

## Per project: use.uiCoverage

The same keys still work in `use.uiCoverage` in `playwright.config.ts` (type `UiCoverageOptions`), for example per project, and win over the config file key by key:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import type { UiCoverageOptions } from 'playwright-ui-coverage';

export default defineConfig<{ uiCoverage: Partial<UiCoverageOptions> }>({
  projects: [{ name: 'webkit', use: { uiCoverage: { format: 'jpeg' } } }],
});
```

A [profile](./configuration.md#profiles) can set `recording` too; it sits between the config file and `use.uiCoverage`, see [Precedence](./configuration.md#precedence).

`ignoreSelectors`, `significantAttributes` and `attributeFilters` are also accepted in `use.uiCoverage`, but deprecated there (and not accepted in `recording`); put them at the top level of the config file instead, see [Report-time rules](../guide/rules.md#deprecated-rules-in-useuicoverage).

## What else is recorded

Each element's tag, attributes, position among siblings, ancestors, `role`, accessible `name` and `nameFrom` are always recorded; see [How it works](../guide/how-it-works.md#1-recording-in-the-browser) and [Raw data format](./raw-data.md).
