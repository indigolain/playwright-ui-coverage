import type { AttributeFilter } from './identity';

export interface UiCoverageOptions {
  /** Turn recording off (e.g. `enabled: !!process.env.UI_COVERAGE`). Default: true. */
  enabled: boolean;
  /** Extra selectors to exclude (elements inside `[data-uicov-ignore]` are always excluded). */
  ignoreSelectors: string[];
  /** ms to wait after an interaction before snapshotting. Default: 250. */
  snapshotDelay: number;
  /**
   * Attributes that identify an element, checked in order after
   * `data-uicov-id` and before the built-in test-id attributes
   * (e.g. `['data-component', 'aria-label']`). Default: [].
   */
  significantAttributes: string[];
  /**
   * Rules for attribute values that must not (or must) be used as identity,
   * evaluated before the built-in rules for generated values. Default: [].
   */
  attributeFilters: AttributeFilter[];
}

export const defaultUiCoverageOptions: UiCoverageOptions = {
  enabled: true,
  ignoreSelectors: [],
  snapshotDelay: 250,
  significantAttributes: [],
  attributeFilters: [],
};

export function resolveOptions(partial?: Partial<UiCoverageOptions>): UiCoverageOptions {
  return { ...defaultUiCoverageOptions, ...partial };
}
