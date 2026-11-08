/**
 * Report-time rules: which recorded elements count, and how they are
 * identified. Pure data + validation; applied by `model/resolve.ts`.
 *
 * `UiCoverageRules` is the single typed object for these rules. The reporter
 * accepts it as part of its options, the `report` CLI reads it from a config
 * file, and the deprecated `use.uiCoverage` fields are recorded with the data
 * and merged in with `mergeRules`.
 */
import { compileSelector, SelectorError } from './selector';

/**
 * A rule deciding whether an attribute value may be used as identity.
 * `attribute` and `value` are regular expression sources, anchored
 * automatically (`^(?:…)$`). Attribute names match case-insensitively,
 * values case-sensitively.
 */
export interface AttributeFilter {
  /** Attribute name pattern, e.g. `'id'` or `'data-.*'`. */
  attribute: string;
  /** Value pattern. Omitted: the rule matches any value of the attribute. */
  value?: string;
  /**
   * `false` (default): matching values are ignored for identity.
   * `true`: matching values are always allowed (overrides later rules,
   * including the built-in ones).
   */
  include?: boolean;
}

/** Rules applied when the report is built (by the reporter or the `report` CLI). */
export interface UiCoverageRules {
  /**
   * Elements matching one of these selectors, or inside an element that does,
   * are excluded. Elements inside `[data-uicov-ignore]` are always excluded.
   * Evaluated on the recorded DOM structure, see README "Report-time selectors".
   */
  ignoreSelectors?: string[];
  /**
   * Attributes that identify an element, checked in order after
   * `data-uicov-id` and before the built-in test-id attributes
   * (e.g. `['data-component', 'aria-label']`).
   */
  significantAttributes?: string[];
  /**
   * Rules for attribute values that must not (or must) be used as identity,
   * evaluated before the built-in rules for generated values.
   */
  attributeFilters?: AttributeFilter[];
}

/** The keys of `UiCoverageRules`, e.g. to pick them out of a larger options object. */
export const RULE_KEYS = ['ignoreSelectors', 'significantAttributes', 'attributeFilters'] as const;

/** Picks the rule fields that are set (`undefined` fields are left out). */
export function pickRules(source: Partial<Record<string, unknown>> | undefined): UiCoverageRules {
  const out: Record<string, unknown> = {};
  for (const k of RULE_KEYS) if (source?.[k] !== undefined) out[k] = source[k];
  return out as UiCoverageRules;
}

/**
 * Combines report-time rules with rules recorded with the data (the
 * deprecated `use.uiCoverage` fields). A field set in `primary`, even to `[]`,
 * replaces the recorded one, so the reporter or CLI config always has the
 * last word.
 */
export function mergeRules(primary: UiCoverageRules, recorded: UiCoverageRules | undefined): UiCoverageRules {
  const out: UiCoverageRules = { ...(recorded ?? {}) };
  for (const k of RULE_KEYS) if (primary[k] !== undefined) (out as any)[k] = primary[k];
  return out;
}

/** Explicit identity override: its value is used as the key, as-is, and is never filtered. */
export const UICOV_ID_ATTRIBUTE = 'data-uicov-id';
/** Elements inside an element with this attribute are always excluded. */
export const UICOV_IGNORE_SELECTOR = '[data-uicov-ignore]';

/** Test-id style attributes checked after `significantAttributes`, in this order. */
export const BUILTIN_IDENTITY_ATTRIBUTES = [
  'data-testid',
  'data-test',
  'data-test-id',
  'data-cy',
  'data-qa',
  'row-id',
];

const ANY = '.*';
const ID_OR_NAME = 'id|name';

/**
 * Values that are generated at runtime and change between renders, builds or
 * runs. Evaluated after the user's `attributeFilters`.
 */
export const BUILTIN_ATTRIBUTE_FILTERS: AttributeFilter[] = [
  // React useId: ":r1:", ":R2kq:" (React 18), "«r1»" (React 19), also as part of a longer id.
  // Only id/name: hand-written test ids like "perm:read:toggle" would otherwise match.
  { attribute: ID_OR_NAME, value: '.*:[rR][0-9a-zA-Z]*:.*' },
  { attribute: ID_OR_NAME, value: '.*«[rR][0-9a-zA-Z]*».*' },
  // UUIDs and long hex strings (hashes, object ids).
  { attribute: ANY, value: '.*[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}.*' },
  { attribute: ANY, value: '.*[0-9a-fA-F]{16,}.*' },
  // Framework counters.
  { attribute: ID_OR_NAME, value: 'ember\\d+' }, // Ember
  { attribute: ID_OR_NAME, value: 'mui-\\d+' }, // MUI
  { attribute: ID_OR_NAME, value: '(radix|headlessui|react-aria|downshift|react-select)-.*' },
  { attribute: ID_OR_NAME, value: '(mat|cdk)-.*\\d+' }, // Angular Material / CDK
  { attribute: ID_OR_NAME, value: 'ui-id-\\d+' }, // jQuery UI
  { attribute: ID_OR_NAME, value: '(ext-gen|ext-comp-|gwt-uid-|yui_)\\S*' }, // ExtJS, GWT, YUI
  { attribute: ID_OR_NAME, value: 'j_id.*' }, // JSF
  // Purely numeric or digit-heavy ids ("42", "el-48213", "input_1699999999").
  { attribute: ID_OR_NAME, value: '\\d+' },
  { attribute: ID_OR_NAME, value: '.*\\d{3,}.*' },
];

export interface CompiledAttributeFilter {
  attribute: RegExp;
  value?: RegExp;
  include: boolean;
}

/** Identity attributes in priority order (after `data-uicov-id`), lowercased and deduplicated. */
export function identityAttributes(rules: UiCoverageRules): string[] {
  const seen = new Set<string>();
  return [...(rules.significantAttributes ?? []), ...BUILTIN_IDENTITY_ATTRIBUTES]
    .map((a) => a.trim().toLowerCase())
    .filter((a) => a && a !== UICOV_ID_ATTRIBUTE && !seen.has(a) && seen.add(a));
}

/** User filters followed by the built-in ones, compiled to anchored regexes. */
export function compileAttributeFilters(rules: UiCoverageRules): CompiledAttributeFilter[] {
  return [...(rules.attributeFilters ?? []), ...BUILTIN_ATTRIBUTE_FILTERS].map((f) => {
    try {
      return {
        attribute: new RegExp(`^(?:${f.attribute})$`, 'i'),
        value: f.value === undefined ? undefined : new RegExp(`^(?:${f.value})$`),
        include: !!f.include,
      };
    } catch (e) {
      throw new Error(
        `[playwright-ui-coverage] invalid attributeFilters entry ${JSON.stringify(f)}: ${(e as Error).message}`,
      );
    }
  });
}

/**
 * Throws a descriptive error for rules that can't be applied: invalid regexes,
 * or selectors that can't be evaluated at report time. Call it early (reporter
 * constructor, CLI start) so mistakes fail fast.
 */
export function validateRules(rules: UiCoverageRules, where = 'options'): void {
  for (const k of ['ignoreSelectors', 'significantAttributes', 'attributeFilters'] as const) {
    const v = rules[k];
    if (v !== undefined && !Array.isArray(v)) throw new Error(`[playwright-ui-coverage] ${where}: ${k} must be an array`);
  }
  compileAttributeFilters(rules);
  for (const s of rules.ignoreSelectors ?? []) {
    try {
      compileSelector(s);
    } catch (e) {
      if (e instanceof SelectorError)
        throw new Error(`[playwright-ui-coverage] ${where}: ignoreSelectors entry ${JSON.stringify(s)}: ${e.message}`);
      throw e;
    }
  }
}
