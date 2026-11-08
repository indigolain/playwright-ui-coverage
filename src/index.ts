import { test as base, expect } from '@playwright/test';
import { ContextRecorder } from './recorder';
import { recordingOptionsFor } from './config';
import type { UiCoverageOptions } from './options';

/**
 * Playwright fixtures that record UI coverage. Compose them with your own
 * fixtures using `mergeTests`:
 *
 *   import { mergeTests } from '@playwright/test';
 *   import { uiCoverage } from 'playwright-ui-coverage';
 *   export const test = mergeTests(myTest, uiCoverage);
 *
 * Configure with `recording` in `ui-coverage.config.*`, or with
 * `use: { uiCoverage: { ... } }` (wins key by key).
 */
export const uiCoverage = base.extend<{ uiCoverage: Partial<UiCoverageOptions> }>({
  uiCoverage: [{}, { option: true, box: true }],
  context: [
    async ({ context, uiCoverage }, use, testInfo) => {
      const options = recordingOptionsFor(testInfo, uiCoverage);
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
  type AutoGroupOptions,
  type ElementGroupRule,
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
export {
  defineUiCoverageConfig,
  type ConfigTrace,
  type UiCoverageConfig,
  type UiCoverageConfigBase,
  type UiCoverageProfile,
  type UiCoverageRecordingConfig,
  type UiCoverageReporterOptions,
} from './config';
export type { ReportOptions } from './report';
export { COVERAGE_SCHEMA_VERSION } from './coverage-report';
export type {
  CoverageReport,
  ReportSummary,
  CoverageCounts,
  ViewCoverage,
  ElementCoverage,
  ElementGroup,
  A11yHint,
  ViewScreenshot,
  TestRef,
  ThresholdCheck,
  RepeatedElement,
} from './coverage-report';
export type { BaselineCheck, BaselineGap, BaselineResolved, ViewRename } from './coverage-report';
export {
  BASELINE_VERSION,
  DEFAULT_BASELINE_FILE,
  checkBaseline,
  createBaseline,
  type BaselineDiff,
  type BaselineFile,
  type BaselineOption,
  type BaselineView,
} from './baseline';
export {
  COMPARISON_VERSION,
  compareReports,
  type ComparedUnit,
  type CoverageComparison,
  type RunTotals,
  type ThresholdChange,
  type ViewComparison,
  type ViewTotals,
} from './compare';
export { MARKDOWN_MARKER, comparisonMarkdown, reportMarkdown, type MarkdownOptions } from './markdown';
