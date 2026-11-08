import { test as base, expect } from '@playwright/test';
import { ContextRecorder } from './recorder';
import { resolveOptions, type UiCoverageOptions } from './options';

/**
 * Playwright fixtures that record UI coverage. Compose them with your own
 * fixtures using `mergeTests`:
 *
 *   import { mergeTests } from '@playwright/test';
 *   import { uiCoverage } from 'playwright-ui-coverage';
 *   export const test = mergeTests(myTest, uiCoverage);
 *
 * Configure with `use: { uiCoverage: { ... } }`.
 */
export const uiCoverage = base.extend<{ uiCoverage: Partial<UiCoverageOptions> }>({
  uiCoverage: [{}, { option: true, box: true }],
  context: [
    async ({ context, uiCoverage }, use, testInfo) => {
      const options = resolveOptions(uiCoverage);
      // attach() returns undefined if `register` mode already records this context.
      const recorder = options.enabled
        ? await ContextRecorder.attach(context, testInfo, options)
        : undefined;
      await use(context);
      await recorder?.finish();
    },
    { scope: 'test', box: true },
  ],
});

/** `@playwright/test`'s `test` with UI coverage built in, for the simplest setup. */
export const test = uiCoverage;

export { expect };
export { defaultUiCoverageOptions, type UiCoverageOptions } from './options';
export {
  BUILTIN_ATTRIBUTE_FILTERS,
  BUILTIN_IDENTITY_ATTRIBUTES,
  type AttributeFilter,
  type UiCoverageRules,
} from './model/rules';
export { RECORDED_CANDIDATES } from './model/elements';
export { resolveCoverageData } from './model/resolve';
export {
  DEFAULT_INTERACTIONS,
  INTERACTION_TYPES,
  type AllowedInteraction,
  type InteractionType,
} from './interactions';
export type { TestCoverageData, Interaction, Snapshot, InventoryElement } from './types';
export type {
  RawCoverageData,
  RawNode,
  RawElement,
  RawElementRef,
  RawSnapshot,
  RawInteraction,
  StoredData,
  StoredAttempt,
} from './model/raw';
export type { UiCoverageReporterOptions } from './report';
