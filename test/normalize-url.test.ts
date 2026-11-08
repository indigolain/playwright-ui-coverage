import { describe, expect, it } from 'vitest';
import { defaultNormalizeUrl } from '../src/aggregate';

const n = (path: string) => defaultNormalizeUrl(`http://localhost:4173${path}`);

describe('defaultNormalizeUrl', () => {
  it('keeps the root and static paths', () => {
    expect(n('/')).toBe('/');
    expect(n('')).toBe('/');
    expect(n('/settings')).toBe('/settings');
    expect(n('/users/new')).toBe('/users/new');
  });

  it('drops the origin', () => {
    expect(defaultNormalizeUrl('https://example.com:8443/settings')).toBe('/settings');
  });

  it('strips the query string', () => {
    expect(n('/users?q=grace&page=2')).toBe('/users');
  });

  it('replaces numeric segments with :id', () => {
    expect(n('/users/42')).toBe('/users/:id');
    expect(n('/orgs/7/users/42/edit')).toBe('/orgs/:id/users/:id/edit');
  });

  it('replaces UUID segments with :id (any case)', () => {
    expect(n('/items/550e8400-e29b-41d4-a716-446655440000')).toBe('/items/:id');
    expect(n('/items/550E8400-E29B-41D4-A716-446655440000')).toBe('/items/:id');
  });

  it('replaces long hex segments (16+ chars) with :id', () => {
    expect(n('/commits/0123456789abcdef')).toBe('/commits/:id');
    expect(n('/objects/507f1f77bcf86cd799439011')).toBe('/objects/:id');
  });

  it('keeps short hex-looking and mixed segments', () => {
    expect(n('/colors/beef')).toBe('/colors/beef');
    expect(n('/commits/0123456789abcde')).toBe('/commits/0123456789abcde'); // 15 chars
    expect(n('/users/user42')).toBe('/users/user42');
    expect(n('/v2/docs')).toBe('/v2/docs');
  });

  it('maps index.html / index.htm to the directory', () => {
    expect(n('/index.html')).toBe('/');
    expect(n('/index.htm')).toBe('/');
    expect(n('/docs/index.html')).toBe('/docs/');
    expect(n('/docs/about.html')).toBe('/docs/about.html');
  });

  it('keeps hash routes and normalizes them', () => {
    expect(n('/#/users/42')).toBe('/#/users/:id');
    expect(n('/app/index.html#/items/550e8400-e29b-41d4-a716-446655440000')).toBe('/app/#/items/:id');
  });

  it('strips the query inside a hash route', () => {
    expect(n('/#/users?tab=admins')).toBe('/#/users');
  });

  it('ignores plain fragments that are not hash routes', () => {
    expect(n('/docs#installation')).toBe('/docs');
    expect(n('/docs#')).toBe('/docs');
  });

  it('returns input that is not an absolute URL unchanged', () => {
    expect(defaultNormalizeUrl('not a url')).toBe('not a url');
    expect(defaultNormalizeUrl('/users/42')).toBe('/users/42');
  });
});
