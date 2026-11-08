// Unit tests for the config: schema validation, merging, profile selection,
// file discovery and loading. Run with the other unit tests: `npm test`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, it } from 'vitest';

import { s, validate, didYouMean, ConfigError } from '../src/schema';
import {
  validateConfig,
  validateReporterOptions,
  userReporterOptions,
  mergeConfig,
  selectProfile,
  profileMatches,
  resolveConfig,
  configTrace,
  findConfigFile,
  loadConfigFile,
  loadConfigFileSync,
  configFilePath,
  defineUiCoverageConfig,
} from '../src/config';

/** The problem lines of a ConfigError thrown by `fn`. */
function problems(fn) {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof ConfigError, `expected a ConfigError, got ${e}`);
    return e.problems;
  }
  assert.fail('expected an error');
}

describe('schema helper', () => {
  const schema = s.object({
    name: s.required(s.string()),
    count: s.number({ min: 0, integer: true }),
    mode: s.oneOf('fast', 'slow'),
    tags: s.array(s.string(), 'an array of tags'),
    rules: s.array(s.rule({ selector: s.required(s.string()) })),
    limit: s.union(s.number(), s.object({ overall: s.number() })),
    views: s.record(s.number()),
  });

  it('accepts a valid object; undefined values count as not set', () => {
    validate(schema, { name: 'x', count: 2, mode: 'fast', tags: [], rules: [{ selector: 'a', comment: 'why' }], limit: 3, views: { '/a': 1 }, unset: undefined }, 'test');
  });

  it('reports unknown keys with a did-you-mean hint', () => {
    assert.deepEqual(problems(() => validate(schema, { name: 'x', cuont: 1 }, 'test')), ['cuont: unknown key (did you mean "count"?)']);
    const [p] = problems(() => validate(schema, { name: 'x', zzzzzzzz: 1 }, 'test'));
    assert.match(p, /^zzzzzzzz: unknown key; allowed: name, count, mode/);
  });

  it('reports wrong types, missing required keys and out-of-range values, all at once', () => {
    assert.deepEqual(
      problems(() =>
        validate(schema, { count: 1.5, mode: 'fats', tags: 'a', rules: [{}], limit: 'x', views: { '/a': 'b' } }, 'test'),
      ),
      [
        'count: must be an integer, got 1.5',
        'mode: must be one of "fast", "slow", got a string ("fats") (did you mean "fast"?)',
        'tags: must be an array of tags, got a string ("a")',
        'rules[0].selector: is required (a string)',
        'limit: must be a number or an object, got a string ("x")',
        'views["/a"]: must be a number, got a string ("b")',
        'name: is required (a string)',
      ],
    );
  });

  it('accepts `comment` on rule objects only', () => {
    validate(s.rule({}), { comment: 'x' }, 'test');
    assert.deepEqual(problems(() => validate(s.object({}), { comment: 'x' }, 'test')), ['comment: unknown key; allowed: ']);
  });

  it('didYouMean only suggests close names', () => {
    assert.equal(didYouMean('ignoreSelector', ['ignoreSelectors', 'threshold']), 'ignoreSelectors');
    assert.equal(didYouMean('xyz', ['ignoreSelectors', 'threshold']), undefined);
  });
});

describe('validateConfig', () => {
  it('accepts every documented key', () => {
    validateConfig(
      defineUiCoverageConfig({
        comment: 'top level',
        ignoreSelectors: ['.cookie-banner', 'footer *', 'iframe#pay >> button', { selector: 'button', documentScope: 'my-widget', comment: 'x' }],
        significantAttributes: ['data-component'],
        attributeFilters: [{ attribute: 'id', value: 'tmp-.*', include: false, comment: 'temp ids' }],
        outputFolder: 'out',
        normalizeUrl: (u) => u,
        maxScreenshotsPerRoute: 2,
        threshold: { overall: 30, views: { '/users/*': 20 } },
        countFailedTests: true,
        viewBy: 'url',
        htmlReport: false,
        testIdAttribute: 'data-test',
        saveData: false,
        baseline: { file: 'b.json', mode: 'check', allowNewViews: true },
        githubSummary: true,
        recording: {
          enabled: true,
          snapshotDelay: 100,
          screenshots: 'first-only',
          format: 'jpeg',
          quality: 70,
          maxScreenshotHeight: 0,
          interactions: ['click', 'focus'],
          allowedInteractions: [{ selector: 'input', events: ['change'], comment: 'date picker' }],
        },
        profiles: [{ name: 'pr', projects: ['chromium'], tags: ['@pr'], comment: 'PR runs', config: { threshold: 50 } }],
      }),
    );
  });

  it('explains keys on the wrong level', () => {
    assert.deepEqual(
      problems(() => validateConfig({ snapshotDelay: 1, recording: { ignoreSelectors: [] }, profiles: [{ name: 'a', config: { profiles: [] } }] })),
      [
        'snapshotDelay: is a recording option: put it in `recording: { snapshotDelay }`',
        'recording.ignoreSelectors: is a report-time rule: put it at the top level, not in `recording`',
        "profiles[0].config.profiles: not allowed here: profiles can't be nested",
      ],
    );
  });

  it('checks selectors, regexes and interaction names', () => {
    const p = problems(() =>
      validateConfig({
        ignoreSelectors: ['a:has(b)'],
        attributeFilters: [{ attribute: '(' }],
        recording: { interactions: ['clik'] },
      }),
    );
    assert.equal(p.length, 3);
    assert.match(p[0], /^ignoreSelectors\[0\]: "a:has\(b\)": .*:has/);
    assert.match(p[1], /^attributeFilters\[0\]\.attribute: invalid regular expression/);
    assert.match(p[2], /^recording\.interactions\[0\]: .*did you mean "click"/);
  });

  it('checks scoped selectors and the baseline option', () => {
    validateConfig({ baseline: true });
    validateConfig({ baseline: 'b.json' });
    const p = problems(() =>
      validateConfig({
        ignoreSelectors: [{ documentScope: 'x' }, { selector: 'a', documentScope: 'x:has(y)' }, { selector: 'a', scope: 'x' }],
        baseline: { mode: 'chek' },
      }),
    );
    assert.equal(p.length, 4, p.join('\n'));
    assert.match(p[0], /^ignoreSelectors\[0\]\.selector: is required/);
    assert.match(p[1], /^ignoreSelectors\[1\]: .*:has/);
    assert.match(p[2], /^ignoreSelectors\[2\]\.scope: unknown key/);
    assert.match(p[3], /^baseline\.mode: .*did you mean "check"/);
  });

  it('requires profile names and config, and unique names', () => {
    assert.deepEqual(problems(() => validateConfig({ profiles: [{ name: ' ' }] })), [
      'profiles[0].name: must not be empty',
      'profiles[0].config: is required (an object)',
    ]);
    assert.throws(() => validateConfig({ profiles: [{ name: 'a', config: {} }, { name: 'a', config: {} }] }), /duplicate name "a"/);
  });

  it('names the source in the message', () => {
    assert.throws(() => validateConfig({ nope: 1 }, 'ui-coverage.config.ts'), /invalid ui-coverage\.config\.ts:\n {2}- nope: unknown key/);
  });
});

describe('reporter options', () => {
  it('drop the keys Playwright adds, and undefined values', () => {
    assert.deepEqual(userReporterOptions({ configDir: '/x', _mode: 'test', _commandHash: 'h', threshold: undefined, viewBy: 'url' }), {
      viewBy: 'url',
    });
  });

  it('accept the config keys plus configFile and profile, but not recording', () => {
    validateReporterOptions({ configFile: false, profile: 'pr', significantAttributes: ['x'], profiles: [{ name: 'pr', config: {} }] });
    assert.match(problems(() => validateReporterOptions({ recording: {} }))[0], /^recording: recording options can't be set in the reporter options/);
    assert.match(
      problems(() => validateReporterOptions({ profiles: [{ name: 'a', config: { recording: {} } }] }))[0],
      /^profiles\[0\]\.config\.recording: recording options can't/,
    );
  });

  it('keep the old messages for rules', () => {
    assert.throws(() => validateReporterOptions({ ignoreSelectors: '.x' }), /ignoreSelectors: must be an array/);
  });
});

describe('mergeConfig', () => {
  it('replaces lists and values, merges objects one level', () => {
    const base = {
      ignoreSelectors: ['a', 'b'],
      threshold: { overall: 30, views: { '/a': 10 } },
      recording: { snapshotDelay: 100, interactions: ['click'] },
      viewBy: 'url',
    };
    assert.deepEqual(
      mergeConfig(base, {
        ignoreSelectors: ['c'],
        threshold: { overall: 50 },
        recording: { interactions: ['input'], format: undefined },
        viewBy: undefined,
      }),
      {
        ignoreSelectors: ['c'],
        threshold: { overall: 50, views: { '/a': 10 } },
        recording: { snapshotDelay: 100, interactions: ['input'] },
        viewBy: 'url',
      },
    );
    // A number replaces an object and the other way round; nested objects are replaced, not merged.
    assert.deepEqual(mergeConfig({ threshold: { overall: 30 } }, { threshold: 40 }), { threshold: 40 });
    assert.deepEqual(mergeConfig({ threshold: 40 }, { threshold: { overall: 30 } }), { threshold: { overall: 30 } });
    assert.deepEqual(
      mergeConfig({ threshold: { views: { '/a': 1, '/b': 2 } } }, { threshold: { views: { '/c': 3 } } }),
      { threshold: { views: { '/c': 3 } } },
    );
  });

  it('does not modify its inputs', () => {
    const base = { recording: { snapshotDelay: 1 } };
    mergeConfig(base, { recording: { snapshotDelay: 2 } });
    assert.deepEqual(base, { recording: { snapshotDelay: 1 } });
  });
});

describe('profiles', () => {
  const run = (projects, ...tags) => ({ projects, tests: tags.map((t) => ({ tags: t })) });
  const profiles = [
    { name: 'manual', config: {} },
    { name: 'pr', tags: ['pr-critical'], config: {} },
    { name: 'mobile', projects: ['mobile-safari', 'mobile-chrome'], config: {} },
    { name: 'mobile-pr', projects: ['mobile-chrome'], tags: ['@pr-critical'], config: {} },
  ];

  it('match by project: every project in the run must be listed', () => {
    assert.ok(profileMatches(profiles[2], run(['mobile-safari'], [])));
    assert.ok(profileMatches(profiles[2], run(['mobile-safari', 'mobile-chrome'], [])));
    assert.ok(!profileMatches(profiles[2], run(['mobile-safari', 'chromium'], [])));
    assert.ok(!profileMatches(profiles[2], run([], [])));
  });

  it('match by tag: every test in the run must have one ("@" optional)', () => {
    assert.ok(profileMatches(profiles[1], run(['chromium'], ['@pr-critical'], ['@slow', '@pr-critical'])));
    assert.ok(!profileMatches(profiles[1], run(['chromium'], ['@pr-critical'], [])));
    assert.ok(!profileMatches(profiles[1], run(['chromium'])));
  });

  it('a profile without projects and tags never matches automatically', () => {
    assert.ok(!profileMatches(profiles[0], run(['chromium'], [])));
  });

  it('first match wins; projects and tags must both match', () => {
    assert.equal(selectProfile(profiles, { run: run(['mobile-chrome'], ['@pr-critical']) }).name, 'pr');
    assert.equal(selectProfile(profiles, { run: run(['mobile-chrome'], []) }).name, 'mobile');
    assert.equal(selectProfile(profiles, { run: run(['chromium'], []) }), undefined);
    assert.equal(selectProfile([profiles[3]], { run: run(['mobile-chrome'], []) }), undefined);
    assert.equal(selectProfile([profiles[3]], { run: run(['mobile-chrome'], ['@pr-critical']) }).name, 'mobile-pr');
  });

  it('an explicit name wins over matching; "" selects none; unknown names fail', () => {
    assert.equal(selectProfile(profiles, { explicit: 'manual', run: run(['mobile-chrome'], []) }).name, 'manual');
    assert.equal(selectProfile(profiles, { explicit: '', run: run(['mobile-chrome'], []) }), undefined);
    assert.throws(() => selectProfile(profiles, { explicit: 'nope' }), /unknown profile "nope"; defined: "manual", "pr"/);
    assert.throws(() => selectProfile(undefined, { explicit: 'nope' }), /defines no profiles/);
  });

  it('resolveConfig layers file, inline options and the profile', () => {
    const file = {
      significantAttributes: ['data-a'],
      threshold: { overall: 30, views: { '/a': 10 } },
      recording: { snapshotDelay: 100 },
      profiles: [{ name: 'pr', tags: ['@pr'], config: { threshold: { overall: 80 }, significantAttributes: ['data-pr'] } }],
    };
    const inline = { configFile: 'x', profile: undefined, threshold: { overall: 40 }, viewBy: 'url' };
    assert.deepEqual(resolveConfig(file, inline, { run: run(['c'], ['@pr']) }), {
      config: {
        significantAttributes: ['data-pr'],
        threshold: { overall: 80, views: { '/a': 10 } },
        recording: { snapshotDelay: 100 },
        viewBy: 'url',
      },
      profile: 'pr',
    });
    assert.deepEqual(resolveConfig(file, inline, { run: run(['c'], []) }).config.threshold, { overall: 40, views: { '/a': 10 } });
    // Inline profiles replace the file's list.
    assert.equal(resolveConfig(file, { profiles: [] }, { run: run(['c'], ['@pr']) }).profile, undefined);
  });

  it('configTrace makes the resolved config JSON (functions named)', () => {
    const trace = configTrace({ config: { normalizeUrl: function myUrls() {}, viewBy: 'url' }, inline: ['viewBy'], profile: undefined });
    assert.deepEqual(trace, {
      source: { file: null, inline: ['viewBy'] },
      profile: null,
      resolved: { normalizeUrl: '[function myUrls]', viewBy: 'url' },
    });
  });
});

describe('config files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uicov-config-test-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, content) => {
    const sub = fs.mkdtempSync(path.join(dir, 'c-'));
    fs.writeFileSync(path.join(sub, name), content);
    return path.join(sub, name);
  };

  it('are found next to the Playwright config; several are an error', () => {
    const file = write('ui-coverage.config.json', '{}');
    assert.equal(findConfigFile(path.dirname(file)), file);
    assert.equal(findConfigFile(dir), undefined);
    fs.writeFileSync(path.join(path.dirname(file), 'ui-coverage.config.mjs'), 'export default {}');
    assert.throws(() => findConfigFile(path.dirname(file)), /several config files.*ui-coverage\.config\.mjs, ui-coverage\.config\.json/);
  });

  it('UI_COVERAGE_CONFIG wins over configFile, which wins over discovery', () => {
    const file = write('ui-coverage.config.json', '{}');
    const d = path.dirname(file);
    assert.equal(configFilePath(d), file);
    assert.equal(configFilePath(d, false), undefined);
    assert.equal(configFilePath(d, 'other.json'), path.join(d, 'other.json'));
    process.env.UI_COVERAGE_CONFIG = 'env.json';
    try {
      assert.equal(configFilePath(d, false), path.resolve('env.json'));
    } finally {
      delete process.env.UI_COVERAGE_CONFIG;
    }
  });

  it('load .json, .cjs and .mjs, sync and async, and validate them', async () => {
    const json = write('a.json', JSON.stringify({ viewBy: 'url' }));
    const cjs = write('b.cjs', 'module.exports = { viewBy: "file" };');
    const mjs = write('c.mjs', 'export default { viewBy: "auto", normalizeUrl: (u) => u };');
    assert.deepEqual(loadConfigFileSync(json), { viewBy: 'url' });
    assert.deepEqual(loadConfigFileSync(cjs), { viewBy: 'file' });
    assert.equal((await loadConfigFile(mjs)).viewBy, 'auto');
    assert.deepEqual(await loadConfigFile(json), { viewBy: 'url' });
    const bad = write('d.json', JSON.stringify({ viewby: 'url' }));
    await assert.rejects(loadConfigFile(bad), /invalid d\.json:\n {2}- viewby: unknown key \(did you mean "viewBy"\?\)/);
    assert.throws(() => loadConfigFileSync(path.join(dir, 'missing.json')), /config file not found/);
    assert.throws(() => loadConfigFileSync(write('e.cjs', 'module.exports = 3;')), /must export the config object/);
  });
});
