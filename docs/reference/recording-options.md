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
    steps: 'on',                         // 'on' | 'off', default: 'off'
    maxStepScreenshots: 50,              // per test, default: 50
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
| `steps` | `'off'` | `'on'` records each test's steps (every counted interaction and page load, with the Playwright call and spec location) and a viewport screenshot after each one, for the [state stepper](../guide/reading-the-report.md#step-through-every-state). Doesn't change coverage. See [Steps](#steps). |
| `maxStepScreenshots` | `50` | Step screenshots per test (`steps: 'on'`); later steps are recorded without one. `0`: steps without screenshots. |

`DEFAULT_INTERACTIONS` (every type except `scroll`, `focus` and `blur`) and `INTERACTION_TYPES` (all of them) are exported from `playwright-ui-coverage`. `defaultUiCoverageOptions` has all the defaults.

## Steps

With `steps: 'on'`, the recorder keeps a step for every interaction it counts (the same events as coverage) and every page load:

- the event (`click`, `input`, `change`, `submit`, `keydown`, …, or `load`), the element (resolved to its key and label at report time), the URL and the time;
- the Playwright call it came from and where it is in the test, when known: `locator.click getByRole('button', { name: 'Save' })` at `users.spec.ts:15`. Typed text is never recorded (only the key of `press` and the URL of `goto`);
- a viewport screenshot of the page right after it (with `screenshots: 'on'`). A step's screenshot holds the test's next action until it's taken, so it shows the page after this step and not after the next one. Identical states are stored once.

**Overhead**, measured on the demo (14 short tests, about 70 steps, Chromium on a laptop):

| | `steps: 'off'` | `steps: 'on'` |
|---|---|---|
| Test time (sum of all tests) | 5.0 s | 7.0 s (about 30 ms per step) |
| Run time (wall clock) | 2.1 s | 2.4 s |
| Report folder (with `data/`) | 1.5 MB | 3.6 MB |

That's why steps are off by default: the extra time is per step, so tests with many quick steps pay the most. Turn them on where you look at the report, for example in a CI job for the main branch, or with a [profile](./configuration.md#profiles).

**Which call:** Playwright's API calls are matched to the DOM events they caused through Playwright's client instrumentation, a private API (the one [register mode](../guide/getting-started.md#turn-recording-on) uses). Both setup modes record the same calls. An event is credited to the action that was in progress when it happened in the page, so a `change` that fires when a click moves the focus away from a field is credited to that click. If a Playwright release changes the instrumentation, steps are recorded without calls.

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
