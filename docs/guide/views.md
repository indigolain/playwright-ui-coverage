# Views

This page explains how URLs are grouped into views (the pages of your app in the report), how to name views with URL patterns, and how to leave URLs out.

A view is one page of the app in the report: its elements, screenshots and coverage. View names are also what [thresholds](../ci/thresholds.md) and the [baseline](../ci/baseline.md) match.

## Automatic grouping

By default URLs are grouped automatically:

- the query string is ignored;
- id-like path segments (numbers, UUIDs, long hex strings) become `:id` (`/users/42?tab=x` → `/users/:id`);
- `#/` hash routes are kept and normalized the same way (`/#/orders/7` → `/#/orders/:id`).

## Naming views: `views` and `viewFilters`

```ts
// ui-coverage.config.ts
import { defineUiCoverageConfig } from 'playwright-ui-coverage/config';

export default defineUiCoverageConfig({
  views: [
    '/users/new',                                         // before the next one: first match wins
    '/users/:username',                                   // /users/ada, /users/grace → one view "/users/:username"
    { pattern: '/docs/:section/*', groupBy: ['section'] }, // /docs/guides/…, /docs/api/… → "/docs/guides/*", "/docs/api/*"
    { pattern: '/#/settings/*', comment: 'hash routes' },
  ],
  viewFilters: [
    { pattern: 'https://auth.example.com/*', include: false }, // the login provider
    { pattern: '/admin/status', include: true },               // protected from the next rule
    { pattern: '/admin/*', include: false },
  ],
});
```

## Which view a URL belongs to

In this order:

1. **`viewFilters`**: the first filter whose pattern matches decides. `include: false` drops the URL before views are built: no view, and the elements and interactions recorded on it don't count anywhere. `include: true` keeps it, whatever later filters say. URLs no filter matches are kept. Links pointing to an excluded URL are dropped too, on any origin: no link unit, and the `<a>` doesn't count as an element.
2. **`views`**: the first matching pattern names the view (of a page, and of a link's destination, see [Links and untested views](./links.md)). A string is `{ pattern }`. The view is named after the pattern as written (`/users/:username`); `groupBy` splits it into one view per value of those named parameters, with the values filled into the name.
3. **`normalizeUrl`** (a function `(url) => viewName`, in a JS/TS config): for the URLs no pattern matches. It's the escape hatch for what patterns can't express, and replaces the automatic rules.
4. **The automatic rules** described above, for everything else.

```ts
// ui-coverage.config.ts: normalizeUrl for what patterns can't express
export default defineUiCoverageConfig({
  normalizeUrl: (url) => new URL(url).pathname.replace(/\/[a-z]{2}-[A-Z]{2}(?=\/|$)/, '/:locale'),
});
```

Component tests grouped by spec file (`viewBy: 'file'`) don't use any of these, see [viewBy](#viewby-url-or-spec-file) below.

## Pattern syntax

A subset of [URLPattern](https://developer.mozilla.org/en-US/docs/Web/API/URL_Pattern_API), implemented by the library, so any Node.js version works:

| Pattern | Matches |
|---|---|
| `/users/:id` | `/users/42`, `/users/ada`: a named parameter is one path segment |
| `/users/:id(\\d+)` | `/users/42`, not `/users/new`: a parameter restricted by a regular expression |
| `/users/:id?` | `/users` and `/users/42`: an optional parameter (with its `/`) |
| `/docs/*` | `/docs/`, `/docs/a/b/c`: `*` matches anything, also across `/` |
| `/#/settings/:tab` | `/#/settings/profile?x=1`: after `#`, the hash route (its own `?…` is ignored) |
| `https://auth.example.com/*` | only that origin; the protocol and host are matched case-insensitively |
| `https://*.example.com/*` | any subdomain (`*` in the host matches any characters) |
| `http://localhost:3000/*` | only that port; without a port any port matches |

- A pattern **without protocol and host matches any origin** (`/admin/*` matches `https://app.example.com/admin/x` and `http://localhost:3000/admin/x`). A pattern with a host and no path matches every path there.
- The **query string is never matched**; `?` in a pattern is an error (except after a parameter). Without `#`, the hash is ignored.
- Paths are case-sensitive and matched as they appear in the URL (percent-encoded); parameter values are decoded for `groupBy` names. A trailing `/` is optional (`/users` matches `/users/`).
- `\` escapes a special character (`/a\*b` matches `/a*b`; in a JS string, write `\\` for each `\`, as in the table). Not supported: `{…}` groups and the `+` / `*` repeat modifiers. Unsupported syntax is a config error.

## Renaming views

Changing a pattern renames views. The baseline matches a renamed view by its untested elements (reported as `view renamed?`), see [Baseline](../ci/baseline.md#what-happens-in-check-mode).

## Using the mapping in your own tooling

`createViewMapper(options)` (exported from `playwright-ui-coverage`) gives you the same mapping: `view(url)` returns the view name, or `null` for a filtered URL, and `included(url)` tells whether a URL is kept.

```ts
import { createViewMapper } from 'playwright-ui-coverage';

const mapper = createViewMapper({ views: ['/users/:username'] });
mapper.view('https://app.example.com/users/ada'); // '/users/:username'
```

## viewBy: URL or spec file

`viewBy` decides what a view is:

- `'url'`: one view per page URL, as described on this page;
- `'file'`: one view per spec file, named by the file's path relative to `testDir`. `views`, `viewFilters` and `normalizeUrl` aren't used, and `threshold.views` keys are file paths;
- `'auto'` (default): `'file'` for [component tests](./component-testing.md), `'url'` otherwise.
