export interface UiCoverageOptions {
  /** Turn recording off (e.g. `enabled: !!process.env.UI_COVERAGE`). Default: true. */
  enabled: boolean;
  /** Extra selectors to exclude (elements inside `[data-uicov-ignore]` are always excluded). */
  ignoreSelectors: string[];
  /** ms to wait after an interaction before snapshotting. Default: 250. */
  snapshotDelay: number;
}

export const defaultUiCoverageOptions: UiCoverageOptions = {
  enabled: true,
  ignoreSelectors: [],
  snapshotDelay: 250,
};

export function resolveOptions(partial?: Partial<UiCoverageOptions>): UiCoverageOptions {
  return { ...defaultUiCoverageOptions, ...partial };
}
