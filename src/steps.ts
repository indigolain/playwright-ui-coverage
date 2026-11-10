/**
 * States and steps (recording option `steps`), for the report's state stepper
 * and per-test walkthrough. Pure; run by `aggregate` after element grouping,
 * so boxes and targets use the report's keys. Nothing here changes coverage:
 * states only show it.
 */
import type { InteractionUse, ScreenshotBox, TestEntry } from './aggregate';
import type { RawCall } from './model/raw';
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

/** Where a state is: a view and its index in that view's `states`. */
export interface StateRef {
  route: string;
  index: number;
}

/** One step of a test attempt, resolved for the walkthrough. */
export interface WalkStep {
  t: number;
  /** DOM event type, or `load`. */
  event: string;
  url: string;
  /** The view of `url`, when it is in the report. */
  route?: string;
  /** The element acted on (report key and label). */
  key?: string;
  label?: string;
  call?: RawCall;
  /**
   * Which instance of a repeated element it acted on (`row 2 of 3 · #user-42`),
   * set when the element stands for several (a group, or instances sharing a key).
   */
  instance?: string;
  /** The page before and after the step, when screenshots were taken. */
  before?: StateRef;
  after?: StateRef;
  /**
   * Index into the boxes of the `before` state of the instance acted on. The
   * walkthrough outlines only it, not every instance of the element. Set only
   * when an identity names the instance's record (`StepTarget.instance`),
   * `before` is the page right before the step (the previous step on the page
   * took it) and the instance is in it. Without such an identity, a re-sort,
   * a recycled row or a late delete can put another record at its place.
   * There's none for `after`: the step may have removed or moved the element.
   */
  beforeBox?: number;
}

/**
 * The box of the instance a step acted on (`StepTarget.instance`) in a state:
 * its index in the state's boxes, or undefined when it isn't there.
 */
export type InstanceBox = (snap: Snapshot, ref: StateRef, key: string, instance: string) => number | undefined;

/** One test attempt: a walkthrough, and a state's "Reached by". */
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
  /** In the order they happened. Empty when the recording has no steps. */
  steps: WalkStep[];
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
        steps: [],
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

/**
 * The walkthrough steps of each attempt: its recordings' steps in time order,
 * each with the state before it (the last state of the same page) and after it.
 */
export function walkSteps(
  tests: TestEntry[],
  attemptOf: number[],
  attempts: AttemptSummary[],
  routeName: (url: string, view?: string) => string | undefined,
  stateRef: (snap: Snapshot) => StateRef | undefined,
  instanceBox?: InstanceBox,
  /** The view's element for `key` stands for several (shows `WalkStep.instance`). */
  repeated?: (route: string, key: string) => boolean,
): void {
  const byAttempt = new Map<number, { rec: number; data: TestEntry['data'] }[]>();
  tests.forEach((t, rec) => {
    if (!t.data.steps?.length) return;
    const a = attemptOf[rec];
    if (!byAttempt.has(a)) byAttempt.set(a, []);
    byAttempt.get(a)!.push({ rec, data: t.data });
  });
  for (const [a, recs] of byAttempt) {
    const all = recs.flatMap(({ rec, data }) =>
      (data.steps ?? []).map((step, i) => ({ step, rec, i, data })),
    );
    all.sort((x, y) => x.step.t - y.step.t || x.rec - y.rec || x.i - y.i);
    /**
     * The last state of each page (recording and page), with its screenshot,
     * and whether the last step on the page took it (else it may be outdated).
     */
    const lastState = new Map<string, { ref: StateRef; snap: Snapshot; fresh: boolean }>();
    attempts[a].steps = all.map(({ step, rec, data }) => {
      const page = `${rec}:${step.page ?? 0}`;
      const route = routeName(step.url, data.view);
      const snap = step.state !== undefined ? data.states?.[step.state] : undefined;
      const after = snap && stateRef(snap);
      // A load starts a new document: what the page showed before isn't this step's "before".
      const last = lastState.get(page);
      const prev = step.event === 'load' ? undefined : last;
      const before = prev?.ref;
      const freshBefore = !!prev?.fresh;
      // A step without a screenshot leaves the last one behind what the page shows.
      if (after) lastState.set(page, { ref: after, snap: snap!, fresh: true });
      else if (last) last.fresh = false;
      const out: WalkStep = { t: step.t, event: step.event, url: step.url };
      if (route !== undefined) out.route = route;
      const target = step.target;
      if (target) {
        out.key = target.key;
        out.label = target.label;
        if (target.hint && route !== undefined && repeated?.(route, target.key)) out.instance = target.hint;
      } else if (step.name) out.label = step.name;
      if (step.call) out.call = step.call;
      if (before) out.before = before;
      if (after) out.after = after;
      if (target?.instance && instanceBox && before && freshBefore) {
        const b = instanceBox(prev!.snap, before, target.key, target.instance);
        if (b !== undefined) out.beforeBox = b;
      }
      return out;
    });
  }
}

/**
 * For "Tested by" links to the walkthrough: per view and element key, per
 * test id, the index of the first step of the test's counted attempt that
 * acted on the element.
 */
export function firstSteps(attempts: AttemptSummary[]): Map<string, Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, Map<string, number>>>();
  for (const a of attempts) {
    if (a.use !== 'tested' || !a.testId) continue;
    a.steps.forEach((s, i) => {
      if (s.route === undefined || s.key === undefined) return;
      if (!out.has(s.route)) out.set(s.route, new Map());
      const byKey = out.get(s.route)!;
      if (!byKey.has(s.key)) byKey.set(s.key, new Map());
      const byTest = byKey.get(s.key)!;
      if (!byTest.has(a.testId!)) byTest.set(a.testId!, i);
    });
  }
  return out;
}
