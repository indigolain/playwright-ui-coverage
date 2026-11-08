# Thresholds

This page shows how to fail a run when UI coverage is below a minimum, overall or per view.

```ts
// ui-coverage.config.ts
import { defineUiCoverageConfig } from 'playwright-ui-coverage/config';

export default defineUiCoverageConfig({
  threshold: {
    overall: 70,
    views: { '/checkout': 95, '/login': 95, '/admin/*': 50 },
  },
});
```

`threshold: 70` is shorthand for `{ overall: 70 }`. If any threshold isn't met, the reporter prints each failing view with its actual and required % and the run fails (exit code 1). The [`report` CLI](../reference/cli.md#report) checks thresholds the same way.

Coverage here is the same number as in the report: tested units (elements and [link units](../guide/links.md#the-denominator)) over all units.

## View keys and patterns

- **View keys** are view names as they appear in the report (`/checkout`, `/users/:id`, after [`views`](../guide/views.md) and `normalizeUrl`). With `viewBy: 'file'` ([component tests](../guide/component-testing.md)), they are spec file paths.
- **Patterns:** `*` matches within one path segment, `**` matches across segments. A pattern applies to each matching view on its own (`'/admin/*': 50` means every admin view needs 50%, not their average).
- **Precedence:** an exact key always wins over a pattern. Among patterns, the one with more literal characters wins, then the one with fewer `**`, then the one listed first.
- **Missing views:** a key or pattern that matches no view in the run prints a warning (with a "did you mean" hint for likely typos) and doesn't fail the run. A filtered run (`--grep`, one spec file) may not visit every view.

## Stricter thresholds for some runs

Use a [profile](../reference/configuration.md#profiles) to raise thresholds for, say, a tagged subset run on every pull request:

```ts
profiles: [
  { name: 'pr-critical', tags: ['@pr-critical'], config: { threshold: { overall: 90 } } },
],
```

Objects are merged one level deep, so the profile keeps the base `threshold.views`.

## In coverage.json

`coverage.json` has a `thresholds` array for CI tooling (empty when `threshold` isn't set):

```json
{ "scope": "view", "view": "/users/:id", "pattern": "/users/*", "required": 20, "actual": 16.7, "status": "failed" }
```

`scope` is `overall` or `view` (then `view` is the view name, or the pattern when it matched no view). `status` is `passed`, `failed` or `missing` (then `actual` is `null`; missing views only warn). See [coverage.json](../coverage-json.md#thresholds-thresholdcheck).

## Thresholds or a baseline?

Thresholds are hard to adopt on a suite with low coverage: you'd have to pick a number below today's and keep raising it by hand. A [baseline](./baseline.md) fails only on *new* untested elements instead. You can use both.
