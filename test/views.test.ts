import { describe, expect, it } from 'vitest';
import { aggregate } from '../src/aggregate';
import { validateConfig } from '../src/config';
import { compileUrlPattern, createViewMapper, UrlPatternError } from '../src/model/views';
import type { TestCoverageData } from '../src/types';

const at = (path: string, origin = 'http://localhost:4173') => `${origin}${path}`;
const m = (pattern: string, url: string) => compileUrlPattern(pattern).match(url);

describe('compileUrlPattern', () => {
  it('matches pathnames with named parameters', () => {
    expect(m('/users/:id', at('/users/42'))).toEqual({ id: '42' });
    expect(m('/users/:id', at('/users/42/'))).toEqual({ id: '42' }); // trailing slash optional
    expect(m('/users/:id', at('/users/42/edit'))).toBeNull(); // one segment
    expect(m('/users/:id', at('/users'))).toBeNull();
    expect(m('/users', at('/users?q=x#top'))).toEqual({}); // query and hash ignored
    expect(m('/Users', at('/users'))).toBeNull(); // pathname is case-sensitive
    expect(m('/users/:name', at('/users/ada%20lovelace'))).toEqual({ name: 'ada lovelace' });
    expect(m('/', at('/'))).toEqual({});
    expect(m('/', at('/x'))).toBeNull();
  });

  it('supports regex-restricted, optional parameters and wildcards', () => {
    expect(m('/users/:id(\\d+)', at('/users/42'))).toEqual({ id: '42' });
    expect(m('/users/:id(\\d+)', at('/users/new'))).toBeNull();
    expect(m('/users/:id(\\d+|me)', at('/users/me'))).toEqual({ id: 'me' });
    expect(m('/users/:id(([0-9])+)/:tab', at('/users/42/posts'))).toEqual({ id: '42', tab: 'posts' });
    expect(m('/users/:id?', at('/users'))).toEqual({});
    expect(m('/users/:id?', at('/users/7'))).toEqual({ id: '7' });
    expect(m('/docs/*', at('/docs/a/b/c'))).toEqual({});
    expect(m('/docs/*', at('/docs/'))).toEqual({});
    expect(m('/docs/:section/*', at('/docs/guides/intro/setup'))).toEqual({ section: 'guides' });
    expect(m('/*.html', at('/a/b.html'))).toEqual({});
    expect(m('/a\\*b', at('/a*b'))).toEqual({});
  });

  it('matches protocol, host and port when given', () => {
    expect(m('https://auth.example.com/*', 'https://auth.example.com/login?x=1')).toEqual({});
    expect(m('https://auth.example.com/*', 'https://AUTH.example.com/login')).toEqual({});
    expect(m('https://auth.example.com/*', 'http://auth.example.com/login')).toBeNull();
    expect(m('https://auth.example.com', 'https://auth.example.com/any/path')).toEqual({}); // no path: any path
    expect(m('https://*.example.com/*', 'https://a.b.example.com/x')).toEqual({});
    expect(m('https://*.example.com/*', 'https://example.org/x')).toBeNull();
    expect(m('*://:tenant.example.com/*', 'http://acme.example.com/x')).toEqual({ tenant: 'acme' });
    expect(m('http://localhost:3000/*', 'http://localhost:3000/x')).toEqual({});
    expect(m('http://localhost:3000/*', 'http://localhost:4000/x')).toBeNull();
    expect(m('http://localhost/*', 'http://localhost:4000/x')).toEqual({}); // no port: any port
    expect(m('/login', 'https://anything.example/login')).toEqual({}); // no origin: any origin
  });

  it('matches hash routes', () => {
    expect(m('/#/users/:id', at('/#/users/1?tab=x'))).toEqual({ id: '1' });
    expect(m('/#/users/:id', at('/users/1'))).toBeNull();
    expect(m('/app#/settings/*', at('/app#/settings/profile'))).toEqual({});
  });

  it('does not match unparseable URLs', () => {
    expect(m('/x', 'not a url')).toBeNull();
  });

  it('rejects what it does not support', () => {
    for (const p of ['users/:id', '/users?page=1', '/a/{b}?', '/users/:id+', '/users/:', '/users/:id(', '/x/:a/:a', '', 'https:///x'])
      expect(() => compileUrlPattern(p), p).toThrow(UrlPatternError);
  });

  it('fills grouped parameters into the name', () => {
    const p = compileUrlPattern('/docs/:section/:page?/*');
    expect(p.names).toEqual(['section', 'page']);
    expect(p.fill({ section: 'guides', page: 'intro' }, ['section'])).toBe('/docs/guides/:page?/*');
    expect(p.fill({ section: 'guides' }, ['section', 'page'])).toBe('/docs/guides/*');
    expect(p.fill({ section: 'guides', page: 'intro' }, ['section', 'page'])).toBe('/docs/guides/intro/*');
  });
});

describe('createViewMapper', () => {
  it('first matching pattern wins; unmatched URLs use the automatic rules', () => {
    const { view } = createViewMapper({ views: ['/users/new', '/users/:username', { pattern: '/users/*' }] });
    expect(view(at('/users/new'))).toBe('/users/new');
    expect(view(at('/users/ada'))).toBe('/users/:username');
    expect(view(at('/users/ada/posts'))).toBe('/users/*');
    expect(view(at('/orders/42?x=1'))).toBe('/orders/:id');
    expect(view(at('/#/orders/42'))).toBe('/#/orders/:id');
  });

  it('groupBy splits a pattern into one view per value', () => {
    const { view } = createViewMapper({ views: [{ pattern: '/docs/:section/*', groupBy: ['section'] }] });
    expect(view(at('/docs/guides/intro'))).toBe('/docs/guides/*');
    expect(view(at('/docs/guides/setup/linux'))).toBe('/docs/guides/*');
    expect(view(at('/docs/api/x'))).toBe('/docs/api/*');
  });

  it('normalizeUrl runs last, for URLs no pattern matches', () => {
    const { view } = createViewMapper({ views: ['/users/:id'], normalizeUrl: (u) => `custom:${new URL(u).pathname}` });
    expect(view(at('/users/1'))).toBe('/users/:id');
    expect(view(at('/settings'))).toBe('custom:/settings');
  });

  it('viewFilters drop URLs before views are built; the first match decides', () => {
    const mapper = createViewMapper({
      views: ['/admin/*'],
      viewFilters: [
        { pattern: 'https://auth.example.com/*', include: false },
        { pattern: '/admin/status', include: true },
        { pattern: '/admin/*', include: false },
      ],
    });
    expect(mapper.view('https://auth.example.com/login')).toBeNull();
    expect(mapper.included('https://auth.example.com/login')).toBe(false);
    expect(mapper.view('https://app.example.com/login')).toBe('/login');
    expect(mapper.view(at('/admin/users'))).toBeNull();
    expect(mapper.view('https://other.example/admin/users')).toBeNull(); // any origin
    expect(mapper.view(at('/admin/status'))).toBe('/admin/*'); // protected by the include
    expect(mapper.included(at('/admin/status'))).toBe(true);
    expect(mapper.included(at('/'))).toBe(true);
  });
});

describe('views in aggregate', () => {
  const box = { x: 0, y: 0, w: 10, h: 10 };
  const data = (url: string, key: string, clicked = false): TestCoverageData => ({
    snapshots: [{ url, dpr: 1, elements: [{ key, label: key, tag: 'button', ...box }] }],
    interactions: clicked ? [{ key, label: key, event: 'click', url }] : [],
  });

  it('builds views from patterns and leaves out filtered URLs', () => {
    const mapper = createViewMapper({
      views: [{ pattern: '/docs/:section/*', groupBy: ['section'] }],
      viewFilters: [{ pattern: '/admin/*', include: false }],
    });
    const summary = aggregate(
      [
        { title: 'a', data: data(at('/docs/guides/a'), 'x', true) },
        { title: 'b', data: data(at('/docs/guides/b'), 'y') },
        { title: 'c', data: data(at('/docs/api/a'), 'x') },
        { title: 'd', data: data(at('/admin/users'), 'z', true) },
      ],
      { viewMapper: mapper, maxScreenshotsPerRoute: 3 },
    );
    expect(summary.routes.map((r) => [r.route, r.tested, r.total])).toEqual([
      ['/docs/api/*', 0, 1],
      ['/docs/guides/*', 1, 2],
    ]);
    expect(summary.total).toBe(3);
  });

  it('a spec-file view (component tests) ignores views and viewFilters', () => {
    const mapper = createViewMapper({ viewFilters: [{ pattern: '/*', include: false }] });
    const summary = aggregate([{ title: 'ct', data: { ...data(at('/'), 'x'), view: 'Button.spec.tsx' } }], {
      viewMapper: mapper,
      maxScreenshotsPerRoute: 3,
    });
    expect(summary.routes.map((r) => r.route)).toEqual(['Button.spec.tsx']);
  });
});

describe('views and links', () => {
  const link = (key: string, href: string) => ({
    key, label: `link "${key}"`, tag: 'a', role: 'link', name: key, nameFrom: 'text', attrs: { href }, x: 0, y: 0, w: 10, h: 10,
  });
  const home = (): TestCoverageData => ({
    snapshots: [
      {
        url: at('/'),
        dpr: 1,
        elements: [
          link('audit', '/settings/audit'),
          link('docs', '/docs/guides/intro'),
          link('auth', 'https://auth.example.com/login'),
          link('ext', 'https://example.com/'),
        ],
      },
    ],
    interactions: [],
  });
  const run = (mapper: ReturnType<typeof createViewMapper>) =>
    aggregate([{ title: 'home', data: home() }], { viewMapper: mapper, maxScreenshotsPerRoute: 3 });

  it('a viewFilter removes the link unit (and untested view) of an excluded destination', () => {
    const before = run(createViewMapper());
    expect(before.routes[0].links.map((l) => l.key)).toEqual(['/docs/guides/intro', '/settings/audit']);
    expect(before.untestedViews?.map((v) => v.view)).toEqual(['/docs/guides/intro', '/settings/audit']);
    const after = run(createViewMapper({ viewFilters: [{ pattern: '/settings/*', include: false }] }));
    expect(after.routes[0].links.map((l) => l.key)).toEqual(['/docs/guides/intro']);
    expect(after.untestedViews?.map((v) => v.view)).toEqual(['/docs/guides/intro']);
    // The <a> isn't counted as an element either.
    expect(after.routes[0].elements.map((e) => e.key).sort()).toEqual(['auth', 'ext']);
  });

  it('drops links to excluded URLs on other origins too', () => {
    const s = run(createViewMapper({ viewFilters: [{ pattern: 'https://auth.example.com/*', include: false }] }));
    expect(s.routes[0].elements.map((e) => e.key)).toEqual(['ext']);
  });

  it('groups link destinations by view patterns', () => {
    const s = run(createViewMapper({ views: [{ pattern: '/docs/:section/*', groupBy: ['section'] }] }));
    expect(s.routes[0].links.map((l) => l.key)).toEqual(['/docs/guides/*', '/settings/audit']);
  });
});

describe('views config validation', () => {
  it('accepts views and viewFilters', () => {
    expect(() =>
      validateConfig({
        views: ['/users/:id', { pattern: '/docs/:section/*', groupBy: ['section'], comment: 'per section' }],
        viewFilters: [{ pattern: 'https://auth.example.com/*', include: false, comment: 'login provider' }],
      }),
    ).not.toThrow();
  });

  it('reports bad patterns, unknown groupBy names and missing include', () => {
    let message = '';
    try {
      validateConfig({
        views: ['users/:id', { pattern: '/docs/:section/*', groupBy: ['sectoin'] }, { pattern: '/x', groupBy: ['y'] }],
        viewFilters: [{ pattern: '/admin/*' }, { pattern: '/a?b', include: false }],
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('views[0]: "users/:id": must start with "/"');
    expect(message).toContain('views[1].groupBy[0]: "sectoin" is not a named parameter of the pattern (it has "section")');
    expect(message).toContain('views[2].groupBy[0]: "y" is not a named parameter of the pattern (it has none)');
    expect(message).toContain('viewFilters[0].include: is required');
    expect(message).toContain('viewFilters[1].pattern: "/a?b": the query string is never matched');
  });
});
