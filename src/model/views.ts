/**
 * Which view a URL belongs to: `viewFilters`, `views` patterns, `normalizeUrl`
 * and the automatic rules (`defaultNormalizeUrl`). Pure: no I/O.
 *
 * `createViewMapper(options).view(url)` is THE function that maps a URL to a
 * view name (or `null` when `viewFilters` exclude the URL). Everything that
 * puts a URL into a view uses it: snapshots and interactions (`aggregate.ts`),
 * and link destinations. `included(url)` is the `viewFilters` predicate alone,
 * e.g. to drop links that point to excluded URLs.
 *
 * Order, for one URL:
 *   1. `viewFilters`: the first matching filter decides; `include: false`
 *      drops the URL entirely (no view, its elements and interactions don't
 *      count), `include: true` keeps it whatever later filters say. No match: kept.
 *   2. `views`: the first matching pattern names the view.
 *   3. `normalizeUrl` (a function, the escape hatch), if set; else
 *   4. the automatic rules: id-like segments → `:id`, query ignored, `#/` hash routes kept.
 *
 * Views don't apply to component tests grouped by spec file (`viewBy: 'file'`).
 *
 * Pattern syntax (a subset of URLPattern; Node's global `URLPattern` isn't
 * used, it's missing or behind a flag in the Node versions we support):
 *
 *   /users/:id               a named parameter: one path segment
 *   /users/:id(\d+)          … restricted by a regular expression
 *   /users/:id?              … optional (with its leading `/`)
 *   /docs/*                  any rest, also across `/` (and empty)
 *   /#/settings/:tab         `#…` matches hash routes (the hash's own `?query` is ignored)
 *   https://auth.example.com/*   protocol and host: only that origin.
 *   https://*.example.com/*      `*` in the host matches any characters
 *   http://localhost:3000/*      an explicit port; without one, any port matches
 *
 * A pattern without protocol and host matches any origin. The query string is
 * never matched. Pathnames are case-sensitive, protocol and host are not. A
 * trailing `/` is optional (`/users` matches `/users/`). `\` escapes a special
 * character. Not supported: `{…}` groups and the `+` / `*` modifiers.
 */
import { s, type Schema } from '../schema';

/** Maps a URL to a view name. */
export type NormalizeUrl = (url: string) => string;

/**
 * A `views` entry. A string is `{ pattern }`. The view is named after the
 * pattern as written (`/users/:username`); `groupBy` splits it into one view
 * per value of those named parameters, with the values put into the name
 * (`/docs/:section/*` with `groupBy: ['section']` → `/docs/guides/*`, `/docs/api/*`).
 */
export interface ViewPattern {
  /** URL pattern, see the module docs / README "Views". */
  pattern: string;
  /** Named parameters of `pattern` whose values split it into separate views. */
  groupBy?: string[];
  /** Free text, ignored. */
  comment?: string;
}

/** A `viewFilters` entry. */
export interface ViewFilter {
  /** URL pattern (same syntax as `views`). Without protocol and host it matches any origin. */
  pattern: string;
  /**
   * `false`: matching URLs are dropped before views are built (no view, their
   * elements and interactions don't count). `true`: matching URLs are kept,
   * whatever later filters say. The first matching filter decides.
   */
  include: boolean;
  /** Free text, ignored. */
  comment?: string;
}

/** The options that decide views (a subset of the reporter options). */
export interface ViewOptions {
  views?: (string | ViewPattern)[];
  viewFilters?: ViewFilter[];
  normalizeUrl?: NormalizeUrl;
}

const ID_SEGMENT = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,})$/i;

/** The automatic rules: `/users/42?tab=x` → `/users/:id`. Hash routes (`#/foo/1`) are kept and normalized too. */
export const defaultNormalizeUrl: NormalizeUrl = (url) => {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const norm = (p: string) =>
    p
      .split('/')
      .map((seg) => (ID_SEGMENT.test(seg) ? ':id' : seg))
      .join('/')
      .replace(/\/index\.html?$/, '/');
  let route = norm(u.pathname) || '/';
  if (u.hash.startsWith('#/')) route += '#' + norm(u.hash.slice(1).split('?')[0]);
  return route;
};

/* ---------------------------------------------------------------- patterns */

/** Thrown for a pattern this matcher can't compile. */
export class UrlPatternError extends Error {
  constructor(pattern: string, message: string) {
    super(`${JSON.stringify(pattern)}: ${message}`);
    this.name = 'UrlPatternError';
  }
}

interface ParamToken {
  name: string;
  /** Span in the pattern source to replace when grouping (includes a leading `/` of an optional param). */
  start: number;
  end: number;
  /** Optional param that owns its leading `/`. */
  slash: boolean;
}

interface Part {
  regex: RegExp;
  params: ParamToken[];
}

export interface CompiledUrlPattern {
  source: string;
  /** Named parameters, in order. */
  names: string[];
  /** Parameter values when `url` matches (unmatched optional parameters are absent), else `null`. */
  match(url: string): Record<string, string> | null;
  /** The pattern with the given parameters replaced by their values (for `groupBy`). */
  fill(values: Record<string, string>, names: readonly string[]): string;
}

const NAME = /^[A-Za-z_$][\w$]*/;
const regexEscape = (c: string) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Turns capturing groups in a parameter's regex into non-capturing ones, so group numbers stay ours. */
function nonCapturing(re: string): string {
  let out = '';
  let inClass = false;
  for (let i = 0; i < re.length; i++) {
    const c = re[i];
    if (c === '\\') {
      out += c + (re[i + 1] ?? '');
      i++;
    } else if (inClass) {
      if (c === ']') inClass = false;
      out += c;
    } else if (c === '[') {
      inClass = true;
      out += c;
    } else if (c === '(' && re[i + 1] !== '?') out += '(?:';
    else if (c === '(' && /^\(\?<[A-Za-z_$]/.test(re.slice(i))) {
      // A named group captures too.
      out += '(?:';
      i = re.indexOf('>', i);
    } else out += c;
  }
  return out;
}

/**
 * Compiles one component (pathname, hash or hostname) of a pattern.
 * `segment` is what a bare `:name` matches; `star` what `*` matches.
 * `offset` is the component's position in the full pattern (for `fill`).
 */
function compilePart(
  pattern: string,
  text: string,
  offset: number,
  o: { segment: string; star: string; trailingSlash: boolean; flags: string },
): Part {
  let re = '';
  const params: ParamToken[] = [];
  let i = 0;
  let lastWasParam = false;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      if (i + 1 >= text.length) throw new UrlPatternError(pattern, 'trailing "\\"');
      re += regexEscape(text[i + 1]);
      i += 2;
      lastWasParam = false;
      continue;
    }
    if (c === ':') {
      const name = NAME.exec(text.slice(i + 1))?.[0];
      if (!name) throw new UrlPatternError(pattern, `":" at ${offset + i} must start a parameter name (":id")`);
      let j = i + 1 + name.length;
      let body = o.segment;
      if (text[j] === '(') {
        let depth = 0;
        let k = j;
        for (; k < text.length; k++) {
          if (text[k] === '\\') {
            k++;
            continue;
          }
          if (text[k] === '(') depth++;
          else if (text[k] === ')' && --depth === 0) break;
        }
        if (k >= text.length) throw new UrlPatternError(pattern, `unclosed "(" after ":${name}"`);
        body = text.slice(j + 1, k);
        try {
          new RegExp(body);
        } catch (e) {
          throw new UrlPatternError(pattern, `invalid regular expression for ":${name}": ${(e as Error).message}`);
        }
        body = nonCapturing(body);
        j = k + 1;
      }
      const optional = text[j] === '?';
      if (optional) j++;
      if (text[j] === '+' || text[j] === '*')
        throw new UrlPatternError(pattern, `the "${text[j]}" modifier after ":${name}" is not supported`);
      if (params.some((p) => p.name === name)) throw new UrlPatternError(pattern, `duplicate parameter ":${name}"`);
      if (optional && re.endsWith('\\/')) {
        re = re.slice(0, -2) + `(?:\\/(${body}))?`;
        params.push({ name, start: offset + i - 1, end: offset + j, slash: true });
      } else {
        re += optional ? `(${body})?` : `(${body})`;
        params.push({ name, start: offset + i, end: offset + j, slash: false });
      }
      i = j;
      lastWasParam = true;
      continue;
    }
    if (c === '*') {
      re += `(?:${o.star})`;
      i++;
      lastWasParam = false;
      continue;
    }
    if (c === '{' || c === '}') throw new UrlPatternError(pattern, '"{…}" groups are not supported');
    if (c === '?' || c === '+')
      throw new UrlPatternError(
        pattern,
        c === '?' && !lastWasParam
          ? 'the query string is never matched (views ignore it); remove "?…" (escape a literal "?" as "\\?")'
          : `unexpected "${c}" (escape a literal one as "\\${c}")`,
      );
    re += regexEscape(c);
    i++;
    lastWasParam = false;
  }
  if (o.trailingSlash && !re.endsWith('\\/')) re += '\\/?';
  return { regex: new RegExp(`^${re}$`, o.flags), params };
}

const PATH = { segment: '[^/]+', star: '.*', trailingSlash: true, flags: '' };
const HOST = { segment: '[^.]+', star: '.*', trailingSlash: false, flags: 'i' };

/**
 * Compiles a `views` / `viewFilters` pattern. Throws `UrlPatternError` for
 * syntax it doesn't support. See the module docs for the syntax.
 */
export function compileUrlPattern(pattern: string): CompiledUrlPattern {
  if (typeof pattern !== 'string' || !pattern) throw new UrlPatternError(String(pattern), 'must be a non-empty string');
  let protocol: RegExp | undefined;
  let host: Part | undefined;
  let port: string | undefined;
  let rest = pattern;
  let restOffset = 0;
  const origin = /^([A-Za-z*][A-Za-z0-9+.*-]*):\/\/([^/#]*)/.exec(pattern);
  if (origin) {
    const [all, proto, authority] = origin;
    protocol = new RegExp(`^${proto.split('*').map(regexEscape).join('.*')}:$`, 'i');
    const portMatch = /:(\d+|\*)$/.exec(authority);
    const hostText = portMatch ? authority.slice(0, portMatch.index) : authority;
    if (!hostText) throw new UrlPatternError(pattern, 'missing host after "://"');
    if (/[@?]/.test(hostText)) throw new UrlPatternError(pattern, 'unsupported characters in the host');
    if (portMatch && portMatch[1] !== '*') port = portMatch[1];
    host = compilePart(pattern, hostText, proto.length + 3, HOST);
    rest = pattern.slice(all.length) || '/*';
    restOffset = all.length;
  } else if (!pattern.startsWith('/')) {
    throw new UrlPatternError(pattern, 'must start with "/" (a path) or a protocol ("https://host/…")');
  }
  // Split off the hash part at the first unescaped "#".
  let hashAt = -1;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '\\') i++;
    else if (rest[i] === '#') {
      hashAt = i;
      break;
    }
  }
  const pathText = hashAt < 0 ? rest : rest.slice(0, hashAt);
  const path = compilePart(pattern, pathText || '/', restOffset, PATH);
  const hash = hashAt < 0 ? undefined : compilePart(pattern, rest.slice(hashAt + 1), restOffset + hashAt + 1, PATH);
  const parts = [host, path, hash].filter((p): p is Part => !!p);
  const params = parts.flatMap((p) => p.params);
  const seen = new Set<string>();
  for (const p of params) {
    if (seen.has(p.name)) throw new UrlPatternError(pattern, `duplicate parameter ":${p.name}"`);
    seen.add(p.name);
  }

  const capture = (part: Part, value: string, out: Record<string, string>): boolean => {
    const m = part.regex.exec(value);
    if (!m) return false;
    part.params.forEach((p, i) => {
      const v = m[i + 1];
      if (v === undefined) return;
      try {
        out[p.name] = decodeURIComponent(v);
      } catch {
        out[p.name] = v;
      }
    });
    return true;
  };

  return {
    source: pattern,
    names: params.map((p) => p.name),
    match(url) {
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        return null;
      }
      const out: Record<string, string> = {};
      if (protocol && !protocol.test(u.protocol)) return null;
      if (host && !capture(host, u.hostname, out)) return null;
      if (port !== undefined && u.port !== port) return null;
      if (!capture(path, u.pathname, out)) return null;
      if (hash && !capture(hash, u.hash.replace(/^#/, '').split('?')[0], out)) return null;
      return out;
    },
    fill(values, names) {
      let result = '';
      let at = 0;
      for (const p of [...params].sort((a, b) => a.start - b.start)) {
        if (!names.includes(p.name)) continue;
        const v = values[p.name];
        result += pattern.slice(at, p.start) + (v === undefined ? '' : (p.slash ? '/' : '') + v);
        at = p.end;
      }
      return result + pattern.slice(at);
    },
  };
}

/* ---------------------------------------------------------------- mapping */

export interface ViewMapper {
  /**
   * The view `url` belongs to, or `null` when `viewFilters` exclude it.
   * Order: `viewFilters` → first matching `views` pattern → `normalizeUrl` → automatic rules.
   */
  view(url: string): string | null;
  /** `viewFilters` alone: false when the URL is excluded (e.g. to drop links pointing to it). */
  included(url: string): boolean;
}

const toPattern = (v: string | ViewPattern): ViewPattern => (typeof v === 'string' ? { pattern: v } : v);

/**
 * Compiles the view options once; `view(url)` is then cheap. Throws
 * `UrlPatternError` for an invalid pattern (validation reports these earlier).
 */
export function createViewMapper(options: ViewOptions = {}): ViewMapper {
  const filters = (options.viewFilters ?? []).map((f) => ({ pattern: compileUrlPattern(f.pattern), include: f.include }));
  const views = (options.views ?? []).map(toPattern).map((v) => ({
    pattern: compileUrlPattern(v.pattern),
    groupBy: v.groupBy ?? [],
  }));
  const fallback = options.normalizeUrl ?? defaultNormalizeUrl;
  const cache = new Map<string, string | null>();

  const included = (url: string) => {
    for (const f of filters) if (f.pattern.match(url)) return f.include;
    return true;
  };
  return {
    included,
    view(url) {
      let r = cache.get(url);
      if (r !== undefined) return r;
      r = null;
      if (included(url)) {
        for (const v of views) {
          const m = v.pattern.match(url);
          if (m) {
            r = v.groupBy.length ? v.pattern.fill(m, v.groupBy) : v.pattern.source;
            break;
          }
        }
        if (r === null) r = fallback(url);
      }
      cache.set(url, r);
      return r;
    },
  };
}

/* ---------------------------------------------------------------- schema */

const patternProblem = (p: string): string | undefined => {
  try {
    compileUrlPattern(p);
    return undefined;
  } catch (e) {
    if (e instanceof UrlPatternError) return e.message;
    throw e;
  }
};

const viewPatternObject = s.rule(
  { pattern: s.required(s.string(patternProblem)), groupBy: s.array(s.string(), 'an array of parameter names') },
  'an object { pattern, groupBy? }',
);
const viewEntry = (): Schema => {
  const shape = s.union(s.string(patternProblem), viewPatternObject);
  return {
    ...shape,
    check(value, path, errors) {
      const before = errors.length;
      shape.check(value, path, errors);
      if (errors.length > before || typeof value === 'string') return;
      const v = value as ViewPattern;
      const names = compileUrlPattern(v.pattern).names;
      (v.groupBy ?? []).forEach((g, i) => {
        if (!names.includes(g))
          errors.push(
            `${path}.groupBy[${i}]: "${g}" is not a named parameter of the pattern` +
              (names.length ? ` (it has ${names.map((n) => `"${n}"`).join(', ')})` : ' (it has none)'),
          );
      });
    },
  };
};

/** Schema entries for `views` and `viewFilters` (part of the reporter settings). */
export const VIEWS_SCHEMA = {
  views: s.array(viewEntry(), 'an array of view patterns'),
  viewFilters: s.array(
    s.rule(
      { pattern: s.required(s.string(patternProblem)), include: s.required(s.boolean()) },
      'an object { pattern, include }',
    ),
    'an array of { pattern, include } filters',
  ),
};
