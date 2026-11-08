import type { AttributeFilter, UiCoverageRules } from './model/rules';
import { DEFAULT_INTERACTIONS, INTERACTION_TYPES, type AllowedInteraction, type InteractionType } from './interactions';
import { s, type SchemaFields } from './schema';

/**
 * Recording options (`recording` in the config file, or `use.uiCoverage`),
 * read by both the fixture and register mode. Rules that can change after
 * recording (`ignoreSelectors`, `significantAttributes`, `attributeFilters`)
 * belong at the top level of the config (`UiCoverageRules`); in
 * `use.uiCoverage` they are deprecated but still honored.
 */
export interface UiCoverageOptions {
  /** Turn recording off (e.g. `enabled: !!process.env.UI_COVERAGE`). Default: true. */
  enabled: boolean;
  /**
   * @deprecated Set `ignoreSelectors` in the config file (top level) instead, so it can
   * change without re-running tests. Still honored: applied while recording
   * (like `data-uicov-interactive="exclude-all"`), so it can't be undone at report time.
   */
  ignoreSelectors: string[];
  /** ms to wait after an interaction before snapshotting. Default: 250. */
  snapshotDelay: number;
  /**
   * Screenshot short-lived UI states right away: when an interaction changes
   * the page so it shows elements no screenshot has shown yet (a modal the
   * test opens, fills and closes within `snapshotDelay`), take a viewport
   * screenshot immediately instead of waiting for `snapshotDelay`. Only with
   * `screenshots: 'on'`. Default: true.
   */
  captureTransientStates: boolean;
  /**
   * @deprecated Set `significantAttributes` in the config file (top level) instead.
   * Still honored: recorded with the data and applied at report time, unless
   * the config sets `significantAttributes` itself.
   */
  significantAttributes: string[];
  /**
   * @deprecated Set `attributeFilters` in the config file (top level) instead.
   * Still honored: recorded with the data and applied at report time, unless
   * the config sets `attributeFilters` itself.
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
  captureTransientStates: true,
  significantAttributes: [],
  attributeFilters: [],
  screenshots: 'on',
  format: 'png',
  quality: 80,
  maxScreenshotHeight: 8000,
  interactions: DEFAULT_INTERACTIONS,
  allowedInteractions: [],
};

/** The deprecated rule keys of `use.uiCoverage` (not accepted in the config file's `recording`). */
type DeprecatedRecordingKeys = 'ignoreSelectors' | 'significantAttributes' | 'attributeFilters';

/** `recording` in the config file: the recording options without the deprecated rules. */
export type UiCoverageRecordingConfig = Partial<Omit<UiCoverageOptions, DeprecatedRecordingKeys>>;

const interaction = () => s.oneOf(...INTERACTION_TYPES);

/** Schema of `recording` in the config file: one entry per key (checked by the compiler). */
export const RECORDING_SCHEMA = {
  enabled: s.boolean(),
  snapshotDelay: s.number({ min: 0 }),
  captureTransientStates: s.boolean(),
  screenshots: s.oneOf('on', 'off', 'first-only'),
  format: s.oneOf('png', 'jpeg'),
  quality: s.number({ min: 0, max: 100 }),
  maxScreenshotHeight: s.number({ min: 0 }),
  interactions: s.array(interaction(), 'an array of interaction types'),
  allowedInteractions: s.array(
    s.rule({ selector: s.required(s.string()), events: s.required(s.array(interaction(), 'an array of interaction types')) }),
    'an array of { selector, events } rules',
  ),
} satisfies SchemaFields<UiCoverageRecordingConfig>;

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
