/**
 * Element identity configuration (node side). The in-page logic lives in
 * `tracker.ts`; this module builds the serializable arguments it receives.
 */

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

/** Explicit identity override: its value is used as the key, as-is, and is never filtered. */
export const UICOV_ID_ATTRIBUTE = 'data-uicov-id';

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

/** Arguments passed to the in-page tracker (must be JSON-serializable). */
export interface IdentityArgs {
  /** Identity attributes in priority order, after `data-uicov-id`. */
  identityAttributes: string[];
  /** User filters followed by the built-in ones, as anchored regex sources. */
  attributeFilters: { attribute: string; value?: string; include: boolean }[];
}

export function identityArgs(opts: {
  significantAttributes?: string[];
  attributeFilters?: AttributeFilter[];
}): IdentityArgs {
  const seen = new Set<string>();
  const identityAttributes = [...(opts.significantAttributes ?? []), ...BUILTIN_IDENTITY_ATTRIBUTES]
    .map((a) => a.trim().toLowerCase())
    .filter((a) => a && a !== UICOV_ID_ATTRIBUTE && !seen.has(a) && seen.add(a));
  const attributeFilters = [...(opts.attributeFilters ?? []), ...BUILTIN_ATTRIBUTE_FILTERS].map(
    (f) => {
      const rule = {
        attribute: `^(?:${f.attribute})$`,
        value: f.value === undefined ? undefined : `^(?:${f.value})$`,
        include: !!f.include,
      };
      try {
        new RegExp(rule.attribute, 'i');
        if (rule.value !== undefined) new RegExp(rule.value);
      } catch (e) {
        throw new Error(
          `[playwright-ui-coverage] invalid attributeFilters entry ${JSON.stringify(f)}: ${(e as Error).message}`,
        );
      }
      return rule;
    },
  );
  return { identityAttributes, attributeFilters };
}
