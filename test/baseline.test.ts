import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkBaseline,
  createBaseline,
  formatBaselineCheck,
  nextFileOf,
  parseBaseline,
  resolveBaselineOption,
  runBaseline,
} from '../src/baseline';
import { matchRenames } from '../src/units';
import { makeReport } from './report-fixture';

const base = makeReport({
  '/settings': { save: true, theme: false, bio: false },
  '/users': { add: true, search: true },
  '/old': { x: false },
});

describe('createBaseline', () => {
  it('lists untested keys per view, sorted, keeping fully tested views', () => {
    expect(createBaseline(base)).toEqual({
      baselineVersion: 1,
      views: {
        '/old': { untestedElements: ['x'] },
        '/settings': { untestedElements: ['bio', 'theme'] },
        '/users': { untestedElements: [] },
      },
    });
    expect(Object.keys(createBaseline(base).views)).toEqual(['/old', '/settings', '/users']);
  });

  it('includes untested links when a report has them', () => {
    const r = makeReport({ '/': { a: true } });
    (r.views[0] as any).links = [
      { key: '/about', tested: false },
      { key: '/home', tested: true },
    ];
    expect(createBaseline(r).views['/']).toEqual({ untestedElements: [], untestedLinks: ['/about'] });
  });
});

describe('checkBaseline', () => {
  const baseline = createBaseline(base);

  it('passes on the same state', () => {
    expect(checkBaseline(baseline, base)).toEqual({ newGaps: [], resolved: [], addedViews: [], removedViews: [], renamedViews: [] });
  });

  it('reports new gaps and resolved units', () => {
    const head = makeReport({
      '/settings': { save: false, theme: true, notify: false },
      '/users': { add: true, search: true },
      '/old': { x: false },
    });
    const diff = checkBaseline(baseline, head);
    expect(diff.newGaps).toEqual([
      { view: '/settings', kind: 'element', key: 'notify', label: 'button "notify"', newView: false },
      { view: '/settings', kind: 'element', key: 'save', label: 'button "save"', newView: false },
    ]);
    expect(diff.resolved).toEqual([
      { view: '/settings', kind: 'element', key: 'bio', reason: 'removed' },
      { view: '/settings', kind: 'element', key: 'theme', reason: 'tested', label: 'button "theme"' },
    ]);
  });

  it('treats removed views as information, and new views as gaps unless allowed', () => {
    const head = makeReport({
      '/settings': { save: true, theme: false, bio: false },
      '/users': { add: true, search: true },
      '/checkout': { pay: false, back: true },
    });
    const diff = checkBaseline(baseline, head);
    expect(diff.removedViews).toEqual(['/old']);
    expect(diff.addedViews).toEqual(['/checkout']);
    expect(diff.newGaps).toEqual([{ view: '/checkout', kind: 'element', key: 'pay', label: 'button "pay"', newView: true }]);
    const allowed = checkBaseline(baseline, head, { allowNewViews: true });
    expect(allowed.newGaps).toEqual([]);
    expect(allowed.addedViews).toEqual(['/checkout']);
  });

  it('matches a renamed view by its untested keys instead of failing all of them', () => {
    const head = makeReport({
      '/preferences': { save: true, theme: false, bio: false, extra: false },
      '/users': { add: true, search: true },
      '/old': { x: false },
    });
    const diff = checkBaseline(baseline, head);
    expect(diff.renamedViews).toEqual([{ from: '/settings', to: '/preferences' }]);
    expect(diff.addedViews).toEqual([]);
    expect(diff.removedViews).toEqual([]);
    expect(diff.newGaps.map((g) => [g.view, g.key, g.newView])).toEqual([['/preferences', 'extra', false]]);
  });

  it('keeps element and link keys apart', () => {
    const head = makeReport({ '/old': { x: true } });
    (head.views[0] as any).links = [{ key: 'x', tested: false, label: 'link "x"' }];
    const diff = checkBaseline({ baselineVersion: 1, views: { '/old': { untestedElements: ['x'] } } }, head);
    expect(diff.newGaps).toEqual([{ view: '/old', kind: 'link', key: 'x', label: 'link "x"', newView: false }]);
    expect(diff.resolved).toEqual([{ view: '/old', kind: 'element', key: 'x', reason: 'tested', label: 'button "x"' }]);
  });
});

describe('matchRenames', () => {
  const set = (...k: string[]) => new Set(k);
  it('pairs the most similar views first and ignores dissimilar or empty ones', () => {
    const removed = new Map([['/a', set('1', '2', '3')], ['/b', set('9')], ['/e', set()]]);
    const added = new Map([['/a2', set('1', '2', '3', '4')], ['/a3', set('1', '2')], ['/z', set('8')], ['/e2', set()]]);
    expect(matchRenames(removed, added)).toEqual([{ from: '/a', to: '/a2' }]);
  });
});

describe('options and files', () => {
  it('resolves the option forms', () => {
    expect(resolveBaselineOption(undefined, '/p')).toBeUndefined();
    expect(resolveBaselineOption(false, '/p')).toBeUndefined();
    expect(resolveBaselineOption({ mode: 'off' }, '/p')).toBeUndefined();
    expect(resolveBaselineOption(true, '/p')).toEqual({ file: path.resolve('/p/ui-coverage-baseline.json'), mode: 'check', allowNewViews: false });
    expect(resolveBaselineOption('b.json', '/p')).toMatchObject({ file: path.resolve('/p/b.json'), mode: 'check' });
    expect(resolveBaselineOption({ file: '/x/b.json', mode: 'update', allowNewViews: true }, '/p')).toEqual({
      file: path.resolve('/x/b.json'),
      mode: 'update',
      allowNewViews: true,
    });
    expect(() => resolveBaselineOption({ mode: 'nope' as any }, '/p')).toThrow(/baseline.mode/);
  });

  it('names the next file', () => {
    expect(nextFileOf('a/ui-coverage-baseline.json')).toBe('a/ui-coverage-baseline.next.json');
    expect(nextFileOf('baseline')).toBe('baseline.next.json');
  });

  it('rejects files that are not baselines', () => {
    expect(() => parseBaseline({ views: {} }, 'f')).toThrow(/baselineVersion/);
    expect(() => parseBaseline({ baselineVersion: 1, views: { '/': { untestedElements: [1] } } }, 'f')).toThrow(/string arrays/);
    expect(parseBaseline({ baselineVersion: 1, views: {} }, 'f')).toEqual({ baselineVersion: 1, views: {} });
  });

  it('runs check and update against files (ratchet)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uicov-baseline-'));
    try {
      const file = path.join(dir, 'ui-coverage-baseline.json');
      const out = path.join(dir, 'report');
      // No baseline yet: warns, writes the next file.
      const missing = runBaseline(base, { file, mode: 'check', allowNewViews: false }, out);
      expect(missing).toMatchObject({ status: 'missing', file: '../ui-coverage-baseline.json', nextFile: '../ui-coverage-baseline.next.json' });
      expect(fs.existsSync(file)).toBe(false);
      expect(JSON.parse(fs.readFileSync(nextFileOf(file), 'utf8'))).toEqual(createBaseline(base));

      expect(runBaseline(base, { file, mode: 'update', allowNewViews: false }, out).status).toBe('updated');
      expect(runBaseline(base, { file, mode: 'check', allowNewViews: false }, out).status).toBe('passed');

      const worse = makeReport({ '/settings': { save: false, theme: false, bio: false }, '/users': { add: true, search: true }, '/old': { x: false } });
      const failed = runBaseline(worse, { file, mode: 'check', allowNewViews: false }, out);
      expect(failed.status).toBe('failed');
      expect(failed.newGaps.map((g) => g.key)).toEqual(['save']);
      const { errors } = formatBaselineCheck(failed);
      expect(errors[0]).toMatch(/1 new untested element\(s\) not in \.\.\/ui-coverage-baseline\.json/);
      expect(errors.join('\n')).toMatch(/\/settings {2}button "save" {2}save/);

      const better = makeReport({ '/settings': { save: true, theme: true, bio: false }, '/users': { add: true, search: true }, '/old': { x: false } });
      const passed = runBaseline(better, { file, mode: 'check', allowNewViews: false }, out);
      expect(passed.status).toBe('passed');
      expect(formatBaselineCheck(passed).info[0]).toMatch(/to ratchet/);
      expect(JSON.parse(fs.readFileSync(nextFileOf(file), 'utf8')).views['/settings'].untestedElements).toEqual(['bio']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
