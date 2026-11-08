// Builds small coverage.json reports for the baseline / compare / markdown tests.
import type { CoverageReport, ElementCoverage, ThresholdCheck, ViewCoverage } from '../src/coverage-report';

/** `{ '/a': { 'button.save': true, 'a.home': false } }`: view → key → tested. */
export type Views = Record<string, Record<string, boolean>>;

const percent = (tested: number, total: number) => (total === 0 ? 100 : Math.round((tested / total) * 1000) / 10);

function counts(elements: ElementCoverage[]) {
  const tested = elements.filter((e) => e.tested).length;
  return {
    coverage: percent(tested, elements.length),
    testedElementsCount: tested,
    untestedElementsCount: elements.length - tested,
    testedLinksCount: 0,
    untestedLinksCount: 0,
    failingOnlyElementsCount: 0,
    a11yHintsCount: 0,
  };
}

export function makeReport(views: Views, thresholds: ThresholdCheck[] = []): CoverageReport {
  const out: ViewCoverage[] = Object.keys(views)
    .sort()
    .map((name) => {
      const elements: ElementCoverage[] = Object.entries(views[name]).map(([key, tested]) => ({
        key,
        label: `button "${key}"`,
        tag: 'button',
        instances: 1,
        tested,
        testIds: tested ? ['t1'] : [],
        failingTestIds: [],
        interactionCounts: tested ? { click: 1 } : ({} as Record<string, number>),
      }));
      return { name, reportUrl: `index.html#${encodeURIComponent(name)}`, summary: counts(elements), elements, links: [], screenshots: [] };
    });
  const all = out.flatMap((v) => v.elements);
  return {
    schemaVersion: 1,
    generatedAt: new Date(0).toISOString(),
    generator: { name: 'playwright-ui-coverage', version: '0.0.0' },
    summary: { viewCount: out.length, untestedViewCount: 0, ...counts(all) },
    views: out,
    untestedViews: [],
    tests: [{ id: 't1', title: 'a.spec.ts › t', passed: true, retry: 0 }],
    thresholds,
    insights: { mostRepeated: [] },
  };
}
