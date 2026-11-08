# Component testing

This page shows how to record UI coverage in Playwright component tests (`@playwright/experimental-ct-react`, `-vue`, `-svelte`, …), in both recording modes.

Every component test loads the same page (the CT dev server's index), so the report has **one view per spec file** instead of one per URL, named by the file's path relative to `testDir`:

```
UI coverage: 55.6% (5/9 elements)
  Counter.spec.tsx           33.3%  1/3
  forms/LoginForm.spec.tsx   66.7%  4/6
```

## Fixture mode

Merge `uiCoverage` into the CT `test`. The CT packages build their `test` on the same Playwright `test` as `@playwright/test`, so `mergeTests` combines them and `mount` keeps working:

```ts
// tests/fixtures.ts
import { test as ctTest, expect } from '@playwright/experimental-ct-react';
import { mergeTests } from '@playwright/test';
import { uiCoverage } from 'playwright-ui-coverage';

export const test = mergeTests(ctTest, uiCoverage);
export { expect };
```

## Register mode

Import `playwright-ui-coverage/register` from `playwright-ct.config.ts`, and keep importing `test` from the CT package. In an ES module config, use `await import('playwright-ui-coverage/register')` or a top-level `import`.

```ts
// playwright-ct.config.ts
import { defineConfig } from '@playwright/experimental-ct-react';
import 'playwright-ui-coverage/register';

export default defineConfig({
  reporter: [['list'], ['playwright-ui-coverage/reporter']],
});
```

## Notes

- **Install `@playwright/test` at the same version as your CT package.** `playwright-ui-coverage` imports `@playwright/test`, and the CT packages are released on their own schedule (e.g. `@playwright/experimental-ct-react@1.62.1` needs `@playwright/test@1.62.1`). With mismatched versions npm installs two copies of Playwright, and the library hooks into the copy your tests don't run on. Check with `npm ls playwright-core`: there should be one version.
- **Grouping:** the reporter's `viewBy` option is `'auto'` by default. It groups by file when the config comes from a CT `defineConfig`, or when the recorded data says it came from a component test (so `merge-reports` with a plain config groups by file too). Set `viewBy: 'file'` or `'url'` to choose yourself. With `'file'`, `views`, `viewFilters` and `normalizeUrl` aren't used, and `threshold.views` keys are file paths (`'components/**'` matches every spec under `components/`).
- **Links:** every link in a component test is an interactive element, tested when clicked; there are no [link units](./links.md).
- CT reuses one browser context for the tests of a worker. Both modes record each test separately anyway.

## Example

[`examples/ct-react`](https://github.com/indigolain/playwright-ui-coverage/tree/main/examples/ct-react) in the repository is a complete React example. From a clone, run it with `npm run example:ct` (fixture mode) or `npm run example:ct:register`.
