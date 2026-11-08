/**
 * A small hand-written schema validator for the config (no dependencies).
 *
 * A schema describes one value. `s.object(fields)` rejects unknown keys (with
 * a "did you mean" hint) and every field is optional unless wrapped in
 * `s.required()`. `s.rule(fields)` is an object that also accepts `comment`.
 * Errors are collected (not thrown one by one) so a config with several
 * mistakes reports all of them at once.
 */

export interface Schema {
  /** What the value must be, for messages: "a string", "an array of strings". */
  readonly expected: string;
  /** Whether `value` has this schema's basic type (used to pick a union member). */
  is(value: unknown): boolean;
  /** Appends `path: message` lines for everything wrong with `value`. */
  check(value: unknown, path: string, errors: string[]): void;
  readonly required?: boolean;
  /** Object schemas only: the allowed keys. */
  readonly fields?: Readonly<Record<string, Schema>>;
}

/**
 * Schema entries for every key of `T`: use with `satisfies` so the compiler
 * reports a key that is in the type but not in the schema, or the other way round.
 */
export type SchemaFields<T> = { [K in keyof Required<T>]: Schema };

/** Thrown for a config that doesn't match its schema; lists every problem. */
export class ConfigError extends Error {
  constructor(
    where: string,
    readonly problems: string[],
  ) {
    super(`[playwright-ui-coverage] invalid ${where}:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof RegExp);

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  if (v instanceof RegExp) return 'a RegExp';
  if (typeof v === 'string') return `a string (${JSON.stringify(v.length > 40 ? v.slice(0, 40) + '…' : v)})`;
  if (typeof v === 'number' || typeof v === 'boolean') return `${typeof v === 'number' ? 'a number' : 'a boolean'} (${v})`;
  if (typeof v === 'function') return 'a function';
  if (typeof v === 'object') return 'an object';
  return String(typeof v);
}

const at = (path: string, msg: string) => (path ? `${path}: ${msg}` : msg);
const keyPath = (path: string, key: string) =>
  /^[A-Za-z_$][\w$]*$/.test(key) ? (path ? `${path}.${key}` : key) : `${path}[${JSON.stringify(key)}]`;

function leaf(expected: string, is: (v: unknown) => boolean, refine?: (v: any) => string | undefined): Schema {
  return {
    expected,
    is,
    check(value, path, errors) {
      if (!is(value)) errors.push(at(path, `must be ${expected}, got ${describe(value)}`));
      else {
        const problem = refine?.(value);
        if (problem) errors.push(at(path, problem));
      }
    },
  };
}

export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** The closest candidate to `name`, if it is close enough to be a typo. */
export function didYouMean(name: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = editDistance(name, c);
    if (d < bestDist) [best, bestDist] = [c, d];
  }
  return best !== undefined && bestDist <= Math.max(2, Math.floor(name.length / 3)) ? best : undefined;
}

export const s = {
  string: (refine?: (v: string) => string | undefined) => leaf('a string', (v) => typeof v === 'string', refine),
  boolean: () => leaf('a boolean', (v) => typeof v === 'boolean'),
  func: () => leaf('a function', (v) => typeof v === 'function'),
  number: (o: { min?: number; max?: number; integer?: boolean } = {}) =>
    leaf(
      o.integer ? 'an integer' : 'a number',
      (v) => typeof v === 'number' && !Number.isNaN(v),
      (v: number) =>
        o.integer && !Number.isInteger(v)
          ? `must be an integer, got ${v}`
          : o.min !== undefined && v < o.min
            ? `must be ≥ ${o.min}, got ${v}`
            : o.max !== undefined && v > o.max
              ? `must be ≤ ${o.max}, got ${v}`
              : undefined,
    ),
  /** One of the given literal values. */
  oneOf: (...values: readonly (string | number | boolean)[]): Schema => {
    const list = values.map((v) => JSON.stringify(v)).join(', ');
    return {
      expected: `one of ${list}`,
      is: (v) => values.includes(v as never),
      check(value, path, errors) {
        if (values.includes(value as never)) return;
        const hint = typeof value === 'string' ? didYouMean(value, values.filter((v) => typeof v === 'string') as string[]) : undefined;
        errors.push(at(path, `must be one of ${list}, got ${describe(value)}${hint ? ` (did you mean ${JSON.stringify(hint)}?)` : ''}`));
      },
    };
  },
  /** `expected` names the whole array in messages, e.g. "an array of selectors". */
  array: (item: Schema, expected = 'an array'): Schema => ({
    expected,
    is: Array.isArray,
    check(value, path, errors) {
      if (!Array.isArray(value)) errors.push(at(path, `must be ${expected}, got ${describe(value)}`));
      else value.forEach((v, i) => item.check(v, `${path}[${i}]`, errors));
    },
  }),
  /** An object whose values all match `value` (keys are free-form, e.g. view names). */
  record: (value: Schema): Schema => ({
    expected: 'an object',
    is: isPlainObject,
    check(v, path, errors) {
      if (!isPlainObject(v)) errors.push(at(path, `must be an object, got ${describe(v)}`));
      else for (const [k, x] of Object.entries(v)) value.check(x, keyPath(path, k), errors);
    },
  }),
  /**
   * An object with exactly these (optional unless `s.required`) keys.
   * `hints` explain specific unknown keys (e.g. a key that belongs elsewhere).
   */
  object: (fields: Record<string, Schema>, expected = 'an object', hints: Record<string, string> = {}): Schema => ({
    expected,
    is: isPlainObject,
    fields,
    check(v, path, errors) {
      if (!isPlainObject(v)) {
        errors.push(at(path, `must be ${expected}, got ${describe(v)}`));
        return;
      }
      const known = Object.keys(fields);
      for (const [k, x] of Object.entries(v)) {
        if (x === undefined) continue; // not set
        const field = fields[k];
        if (!field && Object.prototype.hasOwnProperty.call(hints, k)) {
          errors.push(at(keyPath(path, k), hints[k]));
        } else if (!field) {
          const hint = didYouMean(k, known);
          errors.push(
            at(
              keyPath(path, k),
              `unknown key${hint ? ` (did you mean "${hint}"?)` : `; allowed: ${known.join(', ')}`}`,
            ),
          );
        } else field.check(x, keyPath(path, k), errors);
      }
      for (const [k, field] of Object.entries(fields)) {
        if (field.required && v[k] === undefined) errors.push(at(keyPath(path, k), `is required (${field.expected})`));
      }
    },
  }),
  /** A rule object: like `object`, plus an optional free-text `comment`. */
  rule: (fields: Record<string, Schema>, expected = 'an object', hints?: Record<string, string>): Schema =>
    s.object({ ...fields, comment: s.string() }, expected, hints),
  /** The first member whose basic type matches checks the value. */
  union: (...members: Schema[]): Schema => ({
    expected: members.map((m) => m.expected).join(' or '),
    is: (v) => members.some((m) => m.is(v)),
    check(value, path, errors) {
      const m = members.find((x) => x.is(value));
      if (m) m.check(value, path, errors);
      else errors.push(at(path, `must be ${this.expected}, got ${describe(value)}`));
    },
  }),
  required: (schema: Schema): Schema => ({ ...schema, required: true }),
};

/** Validates `value`; throws a `ConfigError` listing every problem. */
export function validate(schema: Schema, value: unknown, where: string): void {
  const errors: string[] = [];
  schema.check(value, '', errors);
  if (errors.length) throw new ConfigError(where, errors);
}
