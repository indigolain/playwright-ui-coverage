import type { CoverageSummary } from './aggregate';

/**
 * `number` is shorthand for `{ overall: number }`. View keys are route names
 * as they appear in the report (`/checkout`, `/users/:id`), or glob patterns:
 * `*` matches within one path segment, `**` matches across segments.
 */
export type ThresholdOption = number | { overall?: number; views?: Record<string, number> };

export interface ThresholdResult {
  /** Whether this is the overall requirement or one for a view. */
  scope: 'overall' | 'view';
  /** `overall`, or the route name (the pattern, for a pattern that matched no view). */
  target: string;
  /** The `views` key that set this requirement, when it was a pattern. */
  pattern?: string;
  required: number;
  /** Coverage percent; `null` when the configured view wasn't seen in this run. */
  actual: number | null;
  /** False only when coverage was below `required`. Missing views don't fail. */
  passed: boolean;
  status: 'passed' | 'failed' | 'missing';
}

const isPattern = (key: string) => key.includes('*');

function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
      } else re += '[^/]*';
    } else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** Literal (non-wildcard) characters: more means a more specific pattern. */
const specificity = (pattern: string) => pattern.replace(/\*/g, '').length;
const deepWildcards = (pattern: string) => (pattern.match(/\*\*/g) ?? []).length;

/**
 * Check a summary against thresholds. Pure: no I/O.
 *
 * Precedence for a route: an exact key wins; otherwise the matching pattern
 * with the most literal characters, then the one with fewer `**`; remaining
 * ties go to the key declared first.
 */
export function evaluateThresholds(summary: CoverageSummary, option: ThresholdOption | undefined): ThresholdResult[] {
  if (option === undefined) return [];
  const { overall, views = {} } = typeof option === 'number' ? { overall: option } : option;
  const results: ThresholdResult[] = [];
  const check = (target: string, required: number, actual: number, pattern?: string, scope: ThresholdResult['scope'] = 'view'): ThresholdResult => {
    const passed = actual >= required;
    return { scope, target, ...(pattern ? { pattern } : {}), required, actual, passed, status: passed ? 'passed' : 'failed' };
  };

  if (overall !== undefined) results.push(check('overall', overall, summary.percent, undefined, 'overall'));

  const routes = new Map(summary.routes.map((r) => [r.route, r]));
  const entries = Object.entries(views);
  const patterns = entries
    .filter(([key]) => isPattern(key))
    .map(([key, required], order) => ({ key, required, order, re: globToRegExp(key) }))
    .sort((a, b) => specificity(b.key) - specificity(a.key) || deepWildcards(a.key) - deepWildcards(b.key) || a.order - b.order);

  for (const [key, required] of entries) {
    if (isPattern(key)) continue;
    const route = routes.get(key);
    results.push(
      route
        ? check(key, required, route.percent)
        : { scope: 'view', target: key, required, actual: null, passed: true, status: 'missing' },
    );
  }

  for (const route of summary.routes) {
    if (Object.prototype.hasOwnProperty.call(views, route.route)) continue;
    const winner = patterns.find((p) => p.re.test(route.route));
    if (winner) results.push(check(route.route, winner.required, route.percent, winner.key));
  }
  for (const p of patterns) {
    if (!summary.routes.some((r) => p.re.test(r.route))) {
      results.push({ scope: 'view', target: p.key, pattern: p.key, required: p.required, actual: null, passed: true, status: 'missing' });
    }
  }
  return results;
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Closest route name, for "did you mean" hints on typo'd view keys. */
function suggest(target: string, routes: string[]): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  for (const r of routes) {
    const d = editDistance(target, r);
    if (d < bestDist) {
      bestDist = d;
      best = r;
    }
  }
  return best !== undefined && bestDist <= Math.max(2, Math.floor(target.length / 3)) ? best : undefined;
}

/** Console lines for missing views (warnings) and failed thresholds (errors). */
export function formatThresholdResults(
  results: ThresholdResult[],
  routes: string[],
): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  for (const r of results.filter((x) => x.status === 'missing')) {
    const hint = r.pattern ? undefined : suggest(r.target, routes);
    const what = r.pattern ? `pattern "${r.target}" matched no view` : `view "${r.target}" was not found`;
    warnings.push(`UI coverage threshold: ${what} in this run${hint ? ` (did you mean "${hint}"?)` : ''}; skipped.`);
  }
  const failed = results.filter((x) => x.status === 'failed');
  const errors: string[] = [];
  if (failed.length) {
    const width = Math.max(...failed.map((f) => f.target.length));
    errors.push(`UI coverage below threshold (${failed.length}):`);
    for (const f of failed) {
      const via = f.pattern ? `  (via "${f.pattern}")` : '';
      errors.push(`  ${f.target.padEnd(width)}  ${String(f.actual).padStart(5)}%  < ${f.required}% required${via}`);
    }
  }
  return { warnings, errors };
}
