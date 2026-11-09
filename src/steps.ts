/**
 * States and steps (recording option `steps`), for the report's state stepper
 * and per-test walkthrough. Pure; run by `aggregate` after element grouping,
 * so boxes and targets use the report's keys. Nothing here changes coverage:
 * states only show it.
 */
import type { InteractionUse, ScreenshotBox, TestEntry } from './aggregate';
import type { Snapshot } from './types';

/** A distinct state of a view: a screenshot, from any test, with its own coverage. */
export interface RouteState {
  source: string;
  dpr: number;
  /** A viewport screenshot (a step's state, or a short-lived state), not the full page. */
  viewport?: true;
  /** When it was first reached, ms since the epoch (absent in older recordings). */
  t?: number;
  boxes: ScreenshotBox[];
  /** Counted elements and link referrers in the image, and how many of them are tested. */
  total: number;
  tested: number;
  /** The attempts that reached it (indices into `CoverageSummary.attempts`), first one first. */
  attempts: number[];
}

/** One test attempt (a state's "Reached by"). */
export interface AttemptSummary {
  /** `TestCase.id`, when known. */
  testId?: string;
  title: string;
  project?: string;
  /** `TestResult.retry`. */
  retry: number;
  passed: boolean;
  /** How its interactions counted (see `selectAttempts`). */
  use: InteractionUse;
  /** Trace file name in the HTML report (see `AttemptEntry.trace`). */
  trace?: string;
}

/** A screenshot of a recording that can be a state of a view. */
export interface StateCandidate {
  snap: Snapshot;
  /** Index into the attempts. */
  attempt: number;
  /** Order of discovery, for states without a time. */
  seq: number;
}

/** Groups the entries (one per recording) by attempt: test id (or title) and retry. */
export function groupAttempts(tests: TestEntry[]): { attempts: AttemptSummary[]; attemptOf: number[] } {
  const attempts: AttemptSummary[] = [];
  const index = new Map<string, number>();
  const attemptOf = tests.map((t) => {
    const id = JSON.stringify([t.testId ?? t.title, t.retry ?? 0]);
    let i = index.get(id);
    if (i === undefined) {
      i = attempts.length;
      index.set(id, i);
      attempts.push({
        ...(t.testId ? { testId: t.testId } : {}),
        title: t.title,
        ...(t.project ? { project: t.project } : {}),
        retry: t.retry ?? 0,
        passed: t.passed ?? t.interactions !== 'failing',
        use: t.interactions ?? 'tested',
        ...(t.trace ? { trace: t.trace } : {}),
      });
    }
    return i;
  });
  return { attempts, attemptOf };
}

/**
 * The distinct states of one view, in the order they were first reached. The
 * same screenshot (by hash) reached by several attempts is one state.
 * `boxesOf` gives a screenshot's boxes (counted elements in the image);
 * `testedKey` whether an element (or link referrer) of the view is tested.
 */
export function routeStates(
  candidates: StateCandidate[],
  boxesOf: (snap: Snapshot) => ScreenshotBox[],
  testedKey: (key: string) => boolean,
): { states: RouteState[]; indexOf: Map<Snapshot, number> } {
  const sorted = [...candidates].sort((a, b) => (a.snap.t ?? Infinity) - (b.snap.t ?? Infinity) || a.seq - b.seq);
  const states: RouteState[] = [];
  const byHash = new Map<string, number>();
  const indexOf = new Map<Snapshot, number>();
  for (const c of sorted) {
    if (!c.snap.screenshot) continue;
    const known = c.snap.hash !== undefined ? byHash.get(c.snap.hash) : undefined;
    if (known !== undefined) {
      if (!states[known].attempts.includes(c.attempt)) states[known].attempts.push(c.attempt);
      indexOf.set(c.snap, known);
      continue;
    }
    const boxes = boxesOf(c.snap);
    const keys = new Set(boxes.map((b) => b.key));
    const index = states.length;
    states.push({
      source: c.snap.screenshot,
      dpr: c.snap.dpr,
      ...(c.snap.screenshotClip ? { viewport: true as const } : {}),
      ...(c.snap.t !== undefined ? { t: c.snap.t } : {}),
      boxes,
      total: keys.size,
      tested: [...keys].filter(testedKey).length,
      attempts: [c.attempt],
    });
    if (c.snap.hash !== undefined) byHash.set(c.snap.hash, index);
    indexOf.set(c.snap, index);
  }
  return { states, indexOf };
}
