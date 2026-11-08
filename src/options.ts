import type { AttributeFilter } from './identity';
import { DEFAULT_INTERACTIONS, type AllowedInteraction, type InteractionType } from './interactions';

export interface UiCoverageOptions {
  /** Turn recording off (e.g. `enabled: !!process.env.UI_COVERAGE`). Default: true. */
  enabled: boolean;
  /** Extra selectors whose subtrees are excluded, like `data-uicov-interactive="exclude-all"`. Default: []. */
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
