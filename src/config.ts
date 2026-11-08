/**
 * The UI coverage config: one typed, schema-validated object shared by the
 * recorder (fixture and register mode), the reporter and the `report` CLI.
 *
 * Sources, lowest precedence first (see README "Configuration"):
 *   report-time keys: config file → reporter options (inline) → selected profile
 *   recording keys:   config file `recording` → profile `recording` → `use.uiCoverage`
 *
 * Merging (`mergeConfig`): a key that is set replaces the lower layer's value,
 * except plain objects (`recording`, `threshold` as an object), which are
 * merged one level deep. Lists always replace.
 *
 * This module doesn't import `@playwright/test`, so config files can import
 * `defineUiCoverageConfig` from `playwright-ui-coverage/config` cheaply.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TestInfo } from '@playwright/test';
import type { ConfigTrace } from './model/raw';
import { RULES_SCHEMA, type UiCoverageRules } from './model/rules';
import { RECORDING_SCHEMA, resolveOptions, type UiCoverageOptions, type UiCoverageRecordingConfig } from './options';
import type { ReportOptions } from './report';
import { s, validate, type Schema, type SchemaFields } from './schema';

export type { ConfigTrace } from './model/raw';
export type { UiCoverageRecordingConfig } from './options';

/** Report-time rules and reporter settings, plus the recording options. */
export interface UiCoverageConfigBase extends ReportOptions {
  /**
   * Recording options, read by the fixture and register mode in the test
   * workers (from the config file only, not from inline reporter options).
   * `use.uiCoverage` in the Playwright config overrides them key by key.
   */
  recording?: UiCoverageRecordingConfig;
  /** Free text, ignored. */
  comment?: string;
}

/**
 * A named set of overrides, e.g. a narrower `pr-critical` profile for PR runs.
 * Selected explicitly (`UI_COVERAGE_PROFILE`, the reporter's `profile` option,
 * the CLI's `--profile`) or automatically: the first profile whose `projects`
 * and `tags` match the run.
 */
export interface UiCoverageProfile {
  name: string;
  /** Matches when every project that has tests in the run is listed. */
  projects?: string[];
  /** Matches when every test in the run has one of these tags (`@` optional), e.g. after `--grep @pr-critical`. */
  tags?: string[];
  /** Merged over the base config (lists replace, objects merge one level). */
  config: UiCoverageConfigBase;
  /** Free text, ignored. */
  comment?: string;
}

/** `ui-coverage.config.{ts,mjs,js,json}` (or inline reporter options). */
export interface UiCoverageConfig extends UiCoverageConfigBase {
  /** Checked in order; the first match wins. A profile without `projects` and `tags` is only selected explicitly. */
  profiles?: UiCoverageProfile[];
}

/** Reporter options: the config keys (except `recording`), plus where the config file is and which profile to use. */
export interface UiCoverageReporterOptions extends Omit<UiCoverageConfig, 'recording' | 'profiles'> {
  /**
   * The config file, relative to the Playwright config's directory. Default:
   * `ui-coverage.config.*` next to the Playwright config. `false`: no file.
   * The `UI_COVERAGE_CONFIG` environment variable wins over this. Applies to
   * the recorder too (passed to the test workers).
   */
  configFile?: string | false;
  /** Profile to use (by name), instead of automatic selection. `UI_COVERAGE_PROFILE` wins over this. */
  profile?: string;
  /** Profiles; replace the config file's list when set. */
  profiles?: (Omit<UiCoverageProfile, 'config'> & { config: Omit<UiCoverageConfigBase, 'recording'> })[];
}

/** For type checking a config file: `export default defineUiCoverageConfig({ … })`. */
export function defineUiCoverageConfig(config: UiCoverageConfig): UiCoverageConfig {
  return config;
}

/* ---------------------------------------------------------------- schema */

const REPORT_SETTINGS_SCHEMA = {
  outputFolder: s.string(),
  normalizeUrl: s.func(),
  maxScreenshotsPerRoute: s.number({ min: 0, integer: true }),
  threshold: s.union(
    s.number({ min: 0, max: 100 }),
    s.object({ overall: s.number({ min: 0, max: 100 }), views: s.record(s.number({ min: 0, max: 100 })) }),
  ),
  countFailedTests: s.boolean(),
  viewBy: s.oneOf('url', 'file', 'auto'),
  htmlReport: s.union(s.string(), s.oneOf(false)),
  testIdAttribute: s.string(),
  saveData: s.boolean(),
  baseline: s.union(
    s.boolean(),
    s.string(),
    s.rule(
      { file: s.string(), mode: s.oneOf('check', 'update', 'off'), allowNewViews: s.boolean() },
      'an object { file?, mode?, allowNewViews? }',
    ),
  ),
  githubSummary: s.boolean(),
} satisfies SchemaFields<Omit<ReportOptions, keyof UiCoverageRules>>;

/** Fails with `message` whenever the key is present. */
const forbidden = (message: string): Schema => ({
  expected: 'not set',
  is: () => true,
  check: (_v, p, errors) => errors.push(`${p}: ${message}`),
});

// Hints for keys put on the wrong level.
const TOP_LEVEL_HINTS = Object.fromEntries(
  Object.keys(RECORDING_SCHEMA).map((k) => [k, `is a recording option: put it in \`recording: { ${k} }\``]),
);
const RECORDING_HINTS = Object.fromEntries(
  Object.keys(RULES_SCHEMA).map((k) => [k, 'is a report-time rule: put it at the top level, not in `recording`']),
);

const recordingSchema = s.object(RECORDING_SCHEMA, 'an object', RECORDING_HINTS);

/** Keys allowed at the top level and in a profile's `config`. */
const BASE_FIELDS = {
  ...RULES_SCHEMA,
  ...REPORT_SETTINGS_SCHEMA,
  recording: recordingSchema,
  comment: s.string(),
} satisfies SchemaFields<UiCoverageConfigBase>;

const profileSchema = (configFields: Record<string, Schema>) =>
  s.rule(
    {
      name: s.required(s.string((v) => (v.trim() ? undefined : 'must not be empty'))),
      projects: s.array(s.string(), 'an array of project names'),
      tags: s.array(s.string(), 'an array of tags'),
      config: s.required(
        s.object(configFields, 'an object', { ...TOP_LEVEL_HINTS, profiles: 'not allowed here: profiles can\'t be nested' }),
      ),
    },
    'an object { name, projects?, tags?, config }',
  );

/** The config file's schema. */
export const CONFIG_SCHEMA = s.object(
  { ...BASE_FIELDS, profiles: s.array(profileSchema(BASE_FIELDS), 'an array of profiles') } satisfies SchemaFields<UiCoverageConfig>,
  'an object',
  TOP_LEVEL_HINTS,
);

const INLINE_RECORDING = forbidden(
  'recording options can\'t be set in the reporter options (the recorder runs in the test workers and ' +
    'doesn\'t see them): put them in ui-coverage.config.* or in `use.uiCoverage`',
);
const INLINE_BASE_FIELDS = { ...BASE_FIELDS, recording: INLINE_RECORDING };

/** The reporter options' schema (Playwright's own `configDir` and `_*` keys are removed first). */
export const REPORTER_OPTIONS_SCHEMA = s.object(
  {
    ...INLINE_BASE_FIELDS,
    profiles: s.array(profileSchema(INLINE_BASE_FIELDS), 'an array of profiles'),
    configFile: s.union(s.string(), s.oneOf(false)),
    profile: s.string(),
  } satisfies SchemaFields<UiCoverageReporterOptions>,
  'an object',
  TOP_LEVEL_HINTS,
);

function checkProfileNames(config: UiCoverageConfig | UiCoverageReporterOptions, where: string) {
  const seen = new Set<string>();
  for (const p of config.profiles ?? []) {
    if (seen.has(p.name)) throw new Error(`[playwright-ui-coverage] invalid ${where}:\n  - profiles: duplicate name "${p.name}"`);
    seen.add(p.name);
  }
}

/** Validates a config file's content. Throws an error listing every problem. */
export function validateConfig(config: unknown, where = 'config'): asserts config is UiCoverageConfig {
  validate(CONFIG_SCHEMA, config, where);
  checkProfileNames(config as UiCoverageConfig, where);
}

/** Reporter options without the keys Playwright adds (`configDir`, `_mode`, …). */
export function userReporterOptions(options: Record<string, unknown> = {}): UiCoverageReporterOptions {
  return Object.fromEntries(
    Object.entries(options).filter(([k, v]) => k !== 'configDir' && !k.startsWith('_') && v !== undefined),
  ) as UiCoverageReporterOptions;
}

export function validateReporterOptions(options: unknown, where = 'reporter options'): asserts options is UiCoverageReporterOptions {
  validate(REPORTER_OPTIONS_SCHEMA, options, where);
  checkProfileNames(options as UiCoverageReporterOptions, where);
}

/* ---------------------------------------------------------------- merging */

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

const defined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/**
 * `over` on top of `base`: each key set in `over` replaces `base`'s value;
 * when both values are plain objects they are merged one level deep. Lists
 * (and functions, numbers, …) replace. `undefined` values are ignored.
 */
export function mergeConfig<T extends object>(base: T, over: Partial<T> | undefined): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over ?? {})) {
    if (v === undefined) continue;
    const b = out[k];
    out[k] = isPlainObject(b) && isPlainObject(v) ? { ...b, ...defined(v) } : v;
  }
  return out as T;
}

/* ---------------------------------------------------------------- profiles */

/** What automatic profile selection looks at: the projects and tests in the run. */
export interface RunInfo {
  /** Names of the projects that have tests in the run. */
  projects: string[];
  /** Tags of every test in the run. */
  tests: { tags?: string[] }[];
}

const tagName = (t: string) => (t.startsWith('@') ? t : `@${t}`);

/** Whether a profile's `projects` and `tags` match the run (a profile with neither never matches). */
export function profileMatches(profile: Pick<UiCoverageProfile, 'projects' | 'tags'>, run: RunInfo): boolean {
  if (!profile.projects && !profile.tags) return false;
  if (profile.projects && !(run.projects.length > 0 && run.projects.every((p) => profile.projects!.includes(p))))
    return false;
  if (profile.tags) {
    const tags = new Set(profile.tags.map(tagName));
    if (!(run.tests.length > 0 && run.tests.every((t) => (t.tags ?? []).some((x) => tags.has(tagName(x)))))) return false;
  }
  return true;
}

/**
 * The profile to use. `explicit` (a name) wins: `''` means none, an unknown
 * name is an error. Otherwise the first profile that matches `run`.
 */
export function selectProfile<P extends Pick<UiCoverageProfile, 'name' | 'projects' | 'tags'>>(
  profiles: P[] | undefined,
  { explicit, run }: { explicit?: string; run?: RunInfo },
): P | undefined {
  if (explicit !== undefined) {
    if (explicit === '') return undefined;
    const p = profiles?.find((x) => x.name === explicit);
    if (!p) {
      const names = (profiles ?? []).map((x) => `"${x.name}"`).join(', ');
      throw new Error(
        `[playwright-ui-coverage] unknown profile "${explicit}"; ${names ? `defined: ${names}` : 'the config defines no profiles'}`,
      );
    }
    return p;
  }
  return run ? profiles?.find((p) => profileMatches(p, run)) : undefined;
}

/** `UI_COVERAGE_PROFILE` when set (an empty value selects no profile). */
export const envProfile = (): string | undefined => process.env.UI_COVERAGE_PROFILE;

/* ---------------------------------------------------------------- files */

export const CONFIG_FILE_BASENAME = 'ui-coverage.config';
export const CONFIG_FILE_EXTENSIONS = ['.ts', '.mts', '.cts', '.mjs', '.js', '.cjs', '.json'];

/** `ui-coverage.config.*` in `dir`; an error when there are several. */
export function findConfigFile(dir: string): string | undefined {
  const found = CONFIG_FILE_EXTENSIONS.map((e) => path.join(dir, CONFIG_FILE_BASENAME + e)).filter((f) => fs.existsSync(f));
  if (found.length > 1)
    throw new Error(`[playwright-ui-coverage] several config files in ${dir}: ${found.map((f) => path.basename(f)).join(', ')}; keep one`);
  return found[0];
}

function unwrap(mod: any, file: string): unknown {
  // ESM default export, or CommonJS `module.exports` (exposed as `default` too).
  let v = mod?.__esModule || mod?.[Symbol.toStringTag] === 'Module' ? (mod.default ?? mod) : mod;
  if (v && typeof v === 'object' && 'default' in v && Object.keys(v).length === 1) v = v.default;
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new Error(`[playwright-ui-coverage] ${file} must export the config object (export default defineUiCoverageConfig({ … }))`);
  return v;
}

const readJson = (file: string) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`[playwright-ui-coverage] can't read ${file}: ${(e as Error).message}`);
  }
};

function checkExists(file: string) {
  if (!fs.existsSync(file)) throw new Error(`[playwright-ui-coverage] config file not found: ${file}`);
}

/**
 * Loads and validates a config file synchronously. Inside Playwright (the
 * reporter, the test workers) `require` goes through Playwright's TypeScript
 * transform, so `.ts` configs work on any Node.js version.
 */
export function loadConfigFileSync(file: string): UiCoverageConfig {
  checkExists(file);
  let mod: unknown;
  if (path.extname(file).toLowerCase() === '.json') mod = readJson(file);
  else {
    try {
      mod = unwrap(require(file), file);
    } catch (e) {
      if ((e as Error).message.startsWith('[playwright-ui-coverage]')) throw e;
      throw new Error(`[playwright-ui-coverage] can't load ${file}: ${(e as Error).message}`);
    }
  }
  validateConfig(mod, path.basename(file));
  return mod;
}

// tsc compiles `import()` to `require()` for CommonJS output; keep a real dynamic import for ESM/TS configs.
const dynamicImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<any>;

/** Playwright's own loader (TypeScript, extensionless imports), if this Playwright version exposes it. */
function playwrightLoader(): ((file: string) => Promise<any>) | undefined {
  let paths: string[];
  try {
    paths = [path.dirname(require.resolve('@playwright/test/package.json'))];
  } catch {
    return undefined;
  }
  // Bundled into lib/common in recent versions; lib/transform/transform before.
  const candidates: [string, (m: any) => unknown][] = [
    ['playwright/lib/common', (m) => m?.transform?.requireOrImport],
    ['playwright/lib/transform/transform', (m) => m?.requireOrImport],
  ];
  for (const [id, pick] of candidates) {
    try {
      const fn = pick(require(require.resolve(id, { paths })));
      if (typeof fn === 'function') return fn as (file: string) => Promise<any>;
    } catch {
      /* try the next one */
    }
  }
  return undefined;
}

/**
 * Loads and validates a config file outside Playwright (the `report` CLI).
 * TypeScript configs go through Playwright's loader, else Node.js's own
 * TypeScript support (22.18+ / 23.6+).
 */
export async function loadConfigFile(file: string): Promise<UiCoverageConfig> {
  checkExists(file);
  const ext = path.extname(file).toLowerCase();
  let mod: unknown;
  if (ext === '.json') mod = readJson(file);
  else {
    const loader = playwrightLoader();
    try {
      mod = unwrap(loader ? await loader(file) : await dynamicImport(pathToFileURL(file).href), file);
    } catch (e) {
      if ((e as Error).message.startsWith('[playwright-ui-coverage]')) throw e;
      const ts = ['.ts', '.mts', '.cts'].includes(ext)
        ? `\nTypeScript configs need @playwright/test installed, or a Node.js version that can import .ts files (22.18+ / 23.6+).`
        : '';
      throw new Error(`[playwright-ui-coverage] can't load ${file}: ${(e as Error).message}${ts}`);
    }
  }
  validateConfig(mod, path.basename(file));
  return mod;
}

/**
 * The config file to use: `UI_COVERAGE_CONFIG` (relative to the working
 * directory), else `configFile` (relative to `dir`; `false`: none), else
 * `ui-coverage.config.*` in `dir`.
 */
export function configFilePath(dir: string, configFile?: string | false): string | undefined {
  const env = process.env.UI_COVERAGE_CONFIG;
  if (env) return path.resolve(env);
  if (configFile === false) return undefined;
  if (configFile) return path.resolve(dir, configFile);
  return findConfigFile(dir);
}

/* ---------------------------------------------------------------- resolution */

export interface ResolvedConfig {
  /** The merged config, without `profiles`. */
  config: UiCoverageConfigBase;
  file?: string;
  /** Keys set inline (reporter options). */
  inline: string[];
  profile?: string;
}

/**
 * Merges the layers: file → inline → profile (selected from the merged
 * `profiles` list).
 */
export function resolveConfig(
  file: UiCoverageConfig | undefined,
  inline: UiCoverageReporterOptions | undefined,
  select: { explicit?: string; run?: RunInfo },
): { config: UiCoverageConfigBase; profile?: string } {
  const { configFile: _f, profile: _p, ...inlineConfig } = inline ?? {};
  const merged = mergeConfig<UiCoverageConfig>(file ?? {}, inlineConfig as UiCoverageConfig);
  const { profiles, ...base } = merged;
  const profile = selectProfile(profiles, select);
  return { config: profile ? mergeConfig(base, profile.config) : base, profile: profile?.name };
}

const relativeToCwd = (file: string) => {
  const rel = path.relative(process.cwd(), file);
  return (rel.startsWith('..') || path.isAbsolute(rel) ? file : rel).split(path.sep).join('/');
};

/** The `config` entry of `coverage.json` and the data folder. */
export function configTrace(r: ResolvedConfig): ConfigTrace {
  const resolved = JSON.parse(
    JSON.stringify(r.config, (_k, v) => (typeof v === 'function' ? `[function ${v.name || 'anonymous'}]` : v)),
  );
  return {
    source: { file: r.file ? relativeToCwd(r.file) : null, inline: r.inline },
    profile: r.profile ?? null,
    resolved,
  };
}

/* ---------------------------------------------------------------- recorder side */

/**
 * Set by the reporter for the test workers it starts: the config file and
 * profile it resolved, so recording uses the same ones.
 */
const RUN_ENV = 'UI_COVERAGE_RUN';

interface RunDecision {
  pid: number;
  configFile: string | null;
  profile: string | null;
}

/** Called by the reporter in the runner process before the workers start. */
export function publishRunDecision(configFile: string | undefined, profile: string | undefined): void {
  const d: RunDecision = { pid: process.pid, configFile: configFile ?? null, profile: profile ?? null };
  process.env[RUN_ENV] = JSON.stringify(d);
}

function runDecision(): RunDecision | undefined {
  try {
    const d = JSON.parse(process.env[RUN_ENV] ?? '') as RunDecision;
    // Workers are forked by the runner; a nested run started from a test must decide by itself.
    return d && d.pid === process.ppid ? d : undefined;
  } catch {
    return undefined;
  }
}

const fileCache = new Map<string, UiCoverageConfig>();
function cachedConfig(file: string): UiCoverageConfig {
  let c = fileCache.get(file);
  if (!c) fileCache.set(file, (c = loadConfigFileSync(file)));
  return c;
}

/**
 * The recording options for a test: defaults ← config file `recording` ←
 * the selected profile's `recording` ← `use.uiCoverage`.
 *
 * When the reporter is part of the run it has already chosen the file and
 * the profile (for the whole run). Otherwise (e.g. `--reporter=blob` shards)
 * the profile is chosen from this test's project and tags.
 */
export function recordingOptionsFor(testInfo: TestInfo, use: Partial<UiCoverageOptions> | undefined): UiCoverageOptions {
  const decided = runDecision();
  let file: string | undefined;
  let explicit: string | undefined;
  if (decided) {
    file = decided.configFile ?? undefined;
    explicit = decided.profile ?? '';
  } else {
    const dir = testInfo.config.configFile ? path.dirname(testInfo.config.configFile) : process.cwd();
    file = configFilePath(dir);
    explicit = envProfile();
  }
  let recording: UiCoverageRecordingConfig = {};
  if (file) {
    const config = cachedConfig(file);
    const profile = selectProfile(config.profiles, {
      explicit,
      run: { projects: [testInfo.project.name], tests: [{ tags: (testInfo as { tags?: string[] }).tags }] },
    });
    recording = mergeConfig(config.recording ?? {}, profile?.config.recording);
  }
  return resolveOptions(mergeConfig(recording as Partial<UiCoverageOptions>, use));
}
