import type { AttributeFilter, UiCoverageRules } from './model/rules';
import { DEFAULT_INTERACTIONS, type AllowedInteraction, type InteractionType } from './interactions';

/**
 * Recording options (`use.uiCoverage`), read by both the fixture and register
 * mode. Rules that can change after recording (`ignoreSelectors`,
 * `significantAttributes`, `attributeFilters`) belong in the reporter options
 * (`UiCoverageRules`); here they are deprecated but still honored.
 */
export interface UiCoverageOptions {
  /** Turn recording off (e.g. `enabled: !!process.env.UI_COVERAGE`). Default: true. */
  enabled: boolean;
  /**
   * @deprecated Set `ignoreSelectors` in the reporter options instead, so it can
   * change without re-running tests. Still honored: applied while recording
   * (like `data-uicov-interactive="exclude-all"`), so it can't be undone at report time.
   */
  ignoreSelectors: string[];
  /** ms to wait after an interaction before snapshotting. Default: 250. */
  snapshotDelay: number;
  /**
   * @deprecated Set `significantAttributes` in the reporter options instead.
   * Still honored: recorded with the data and applied at report time, unless
   * the reporter options set `significantAttributes` themselves.
   */
  significantAttributes: string[];
  /**
   * @deprecated Set `attributeFilters` in the reporter options instead.
   * Still honored: recorded with the data and applied at report time, unless
   * the reporter options set `attributeFilters` themselves.
   */
  attributeFilters: AttributeFilter[];
  /**
   * When to take screenshots. Elements are recorded either way.
   * - `'on'` (default): whenever a page state shows elements no screenshot has shown yet.
   * - `'first-only'`: at most one screenshot per URL per test.
   * - `'off'`: never; the report shows the element tables only.
   */
  screenshots: 'on' | 'off' | 'first-only';
  /** Screenshot image format. `'jpeg'` files are usually much smaller. Default: `'png'`. */
  format: 'png' | 'jpeg';
  /** JPEG quality, 0-100 (ignored for PNG). Default: 80. */
  quality: number;
  /**
   * Max full-page screenshot height in CSS pixels. Taller pages are cropped
   * to this height; elements below it are still counted, just not drawn.
   * `0` disables the cap. Default: 8000.
   */
  maxScreenshotHeight: number;
  /**
   * DOM events that count as interactions. Default: every supported type
   * except `focus` and `blur` (see `INTERACTION_TYPES`).
   */
  interactions: InteractionType[];
  /**
   * Per-element restrictions: for elements matching `selector`, only `events`
   * count (the first matching rule wins). Default: [].
   */
  allowedInteractions: AllowedInteraction[];
}

export const defaultUiCoverageOptions: UiCoverageOptions = {
  enabled: true,
  ignoreSelectors: [],
  snapshotDelay: 250,
  significantAttributes: [],
  attributeFilters: [],
  screenshots: 'on',
  format: 'png',
  quality: 80,
  maxScreenshotHeight: 8000,
  interactions: DEFAULT_INTERACTIONS,
  allowedInteractions: [],
};

export function resolveOptions(partial?: Partial<UiCoverageOptions>): UiCoverageOptions {
  return { ...defaultUiCoverageOptions, ...partial };
}

/**
 * The deprecated identity rules set in `use.uiCoverage`, recorded with the
 * data so the reporter (and the CLI) apply them. Empty lists are left out.
 */
export function recordedRules(options: Partial<UiCoverageOptions>): UiCoverageRules {
  const out: UiCoverageRules = {};
  if (options.significantAttributes?.length) out.significantAttributes = [...options.significantAttributes];
  if (options.attributeFilters?.length) out.attributeFilters = options.attributeFilters.map((f) => ({ ...f }));
  return out;
}
