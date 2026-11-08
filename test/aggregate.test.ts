import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { aggregate, defaultNormalizeUrl, type CoverageSummary } from '../src/aggregate';
import type { InventoryElement, TestCoverageData } from '../src/types';

const fixture = (name: string): TestCoverageData =>
  JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.json`), 'utf8'));

const tests = () => [
  { title: 'users › search', data: fixture('users-search') },
  { title: 'users › add', data: fixture('users-add') },
  { title: 'app › hash routes', data: fixture('hash-app') },
];

const opts = { normalizeUrl: defaultNormalizeUrl, maxScreenshotsPerRoute: 3 };

const route = (summary: CoverageSummary, name: string) => {
  const r = summary.routes.find((r) => r.route === name);
  if (!r) throw new Error(`no route ${name} in ${summary.routes.map((r) => r.route).join(', ')}`);
  return r;
};
const element = (summary: CoverageSummary, routeName: string, key: string) => {
  const e = route(summary, routeName).elements.find((e) => e.key === key);
  if (!e) throw new Error(`no element ${key} on ${routeName}`);
  return e;
};

const el = (key: string, x = 0): InventoryElement => ({ key, label: key, tag: 'button', x, y: 0, w: 10, h: 10 });
const snap = (screenshot: string | undefined, keys: string[], url = 'http://x/page') => ({
  url,
  dpr: 1,
  screenshot,
  elements: keys.map((k, i) => el(k, i * 20)),
});

describe('aggregate', () => {
  it('matches the snapshot', () => {
    const { generatedAt, ...summary } = aggregate(tests(), opts);
    expect(Date.parse(generatedAt)).not.toBeNaN();
    expect(summary).toMatchSnapshot();
  });

  it('groups URLs into routes, sorted by route', () => {
    expect(aggregate(tests(), opts).routes.map((r) => r.route)).toEqual(['/app/#/items/:id', '/users', '/users/:id']);
  });

  it('merges multiple tests on one route', () => {
    const s = aggregate(tests(), opts);
    const users = route(s, '/users');
    // Union of both tests' inventories plus the never-inventoried interactions.
    expect(users.elements.map((e) => e.key).sort()).toEqual(
      [
        '#new-name',
        '#search',
        '[data-testid="add-user"]',
        'button "Cancel"',
        'button "Delete"',
        'button "Dismiss"',
        'button "Save"',
        'link "Ada Lovelace"',
        'link "Grace Hopper"',
        'link "Katherine Johnson"',
      ].sort(),
    );
    expect(element(s, '/users', '#search').testedBy).toEqual(['users › search']);
    expect(element(s, '/users', '[data-testid="add-user"]').testedBy).toEqual(['users › add']);
    expect(element(s, '/users', 'link "Ada Lovelace"').tested).toBe(false);
  });

  it('lists each test once in testedBy, in order of first interaction', () => {
    const data = fixture('users-search');
    const s = aggregate(
      [
        { title: 'b', data },
        { title: 'a', data },
      ],
      opts,
    );
    // users-search interacts with #search twice.
    expect(element(s, '/users', '#search').testedBy).toEqual(['b', 'a']);
  });

  it('counts interactions on elements that were never inventoried', () => {
    const s = aggregate(tests(), opts);
    expect(element(s, '/users', 'button "Dismiss"')).toEqual({
      key: 'button "Dismiss"',
      label: 'button "Dismiss"',
      tag: '?',
      instances: 1,
      tested: true,
      testedBy: ['users › add'],
    });
  });

  it('keeps the inventoried tag for interactions on inventoried elements', () => {
    const s = aggregate(tests(), opts);
    // "Katherine Johnson" appears only in users-add's last snapshot (no screenshot).
    expect(element(s, '/users', 'link "Katherine Johnson"').tag).toBe('a');
  });

  it('uses the max number of simultaneous instances of a repeated key', () => {
    const s = aggregate(tests(), opts);
    // 2 rows in users-search, 3 rows after adding a user in users-add.
    expect(element(s, '/users', 'button "Delete"').instances).toBe(3);
    expect(element(s, '/users', '#search').instances).toBe(1);
    const users = route(s, '/users');
    // A repeated key is still one element.
    expect(users.elements.filter((e) => e.key === 'button "Delete"')).toHaveLength(1);
  });

  it('creates routes that only have interactions, without screenshots', () => {
    const s = aggregate(tests(), opts);
    const detail = route(s, '/users/:id');
    expect(detail.screenshots).toEqual([]);
    expect(detail).toMatchObject({ total: 1, tested: 1, percent: 100 });
  });

  it('keeps routes whose snapshots have no screenshot', () => {
    const s = aggregate(tests(), opts);
    const app = route(s, '/app/#/items/:id');
    expect(app.screenshots).toEqual([]);
    expect(app).toMatchObject({ total: 3, tested: 1, percent: 33.3 });
  });

  it('computes percentages rounded to one decimal', () => {
    const s = aggregate(tests(), opts);
    expect(route(s, '/users')).toMatchObject({ total: 10, tested: 6, percent: 60 });
    expect(s).toMatchObject({ total: 14, tested: 8, percent: 57.1 });
  });

  it('reports 100% when there is nothing to cover', () => {
    const s = aggregate([], opts);
    expect(s).toMatchObject({ total: 0, tested: 0, percent: 100, routes: [] });
  });

  it('sorts untested elements first, then by label', () => {
    const labels = route(aggregate(tests(), opts), '/app/#/items/:id').elements.map((e) => [e.tested, e.label]);
    expect(labels).toEqual([
      [false, 'button "Archive"'],
      [false, 'button "Cancel"'],
      [true, 'button "Save"'],
    ]);
  });

  it('uses a custom normalizeUrl', () => {
    const s = aggregate(tests(), { ...opts, normalizeUrl: (url) => new URL(url).pathname.split('/')[1] || 'home' });
    expect(s.routes.map((r) => r.route)).toEqual(['app', 'users']);
  });

  describe('screenshot selection', () => {
    it('picks screenshots greedily by how many unseen elements they add', () => {
      const s = aggregate(
        [
          {
            title: 't1',
            data: {
              interactions: [],
              snapshots: [snap('/a.png', ['a', 'b']), snap('/b.png', ['a', 'b', 'c', 'd']), snap('/c.png', ['d', 'e'])],
            },
          },
        ],
        opts,
      );
      expect(s.routes[0].screenshots.map((x) => x.source)).toEqual(['/b.png', '/c.png']);
    });

    it('skips screenshots that add no new elements', () => {
      const s = aggregate(
        [
          { title: 't1', data: { interactions: [], snapshots: [snap('/a.png', ['a', 'b'])] } },
          { title: 't2', data: { interactions: [], snapshots: [snap('/b.png', ['b', 'a'])] } },
        ],
        opts,
      );
      expect(s.routes[0].screenshots.map((x) => [x.source, x.test])).toEqual([['/a.png', 't1']]);
    });

    it('ignores snapshots without a screenshot', () => {
      const s = aggregate(
        [{ title: 't', data: { interactions: [], snapshots: [snap(undefined, ['a', 'b', 'c']), snap('/a.png', ['a'])] } }],
        opts,
      );
      expect(s.routes[0].screenshots.map((x) => x.source)).toEqual(['/a.png']);
      expect(s.routes[0].total).toBe(3);
    });

    it('respects maxScreenshotsPerRoute', () => {
      const data: TestCoverageData = {
        interactions: [],
        snapshots: [snap('/a.png', ['a']), snap('/b.png', ['b']), snap('/c.png', ['c'])],
      };
      expect(aggregate([{ title: 't', data }], { ...opts, maxScreenshotsPerRoute: 2 }).routes[0].screenshots).toHaveLength(2);
      expect(aggregate([{ title: 't', data }], { ...opts, maxScreenshotsPerRoute: 0 }).routes[0].screenshots).toHaveLength(0);
    });

    it('keeps dpr, test title and every box of the chosen screenshot', () => {
      const s = aggregate([{ title: 'users › add', data: fixture('users-add') }], opts);
      const [first, second] = route(s, '/users').screenshots;
      expect(first).toMatchObject({ source: '/results/users-add/ui-coverage-0.png', dpr: 2, test: 'users › add' });
      // Both "Delete" instances get a box.
      expect(first.boxes.filter((b) => b.key === 'button "Delete"')).toEqual([
        { key: 'button "Delete"', x: 300, y: 50, w: 60, h: 20 },
        { key: 'button "Delete"', x: 300, y: 80, w: 60, h: 20 },
      ]);
      expect(second.source).toBe('/results/users-add/ui-coverage-1.png');
    });

    it('selects screenshots per route', () => {
      const s = aggregate(
        [
          {
            title: 't',
            data: {
              interactions: [],
              snapshots: [snap('/a.png', ['a'], 'http://x/one'), snap('/b.png', ['a'], 'http://x/two')],
            },
          },
        ],
        opts,
      );
      expect(s.routes.map((r) => [r.route, r.screenshots.map((x) => x.source)])).toEqual([
        ['/one', ['/a.png']],
        ['/two', ['/b.png']],
      ]);
    });
  });
});
