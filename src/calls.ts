/**
 * Which Playwright call caused a step (recording option `steps`).
 *
 * The tracker sees DOM events, not API calls. Playwright's client
 * instrumentation (the hook its test runner turns API calls into report steps
 * with, and that register mode starts recording from) tells us the calls in
 * progress: `onApiCallBegin` gets the call's API name (`locator.click`), its
 * protocol params (the selector) and the user's stack frames, `onApiCallEnd`
 * says when it's done.
 *
 * An event is credited to the action that was in progress when it happened in
 * the page: the tracker stamps each event with the time, and an event's
 * binding call can reach Node after the call that caused it has returned (and
 * the next one has begun). Without a usable time, the action in progress
 * when the event arrives is used, or the one that ended just before.
 *
 * Both recording modes reach the instrumentation the same way (through the
 * browser context), so they record the same calls. It's a private API: when
 * its shape isn't what we expect, `trackCalls` returns undefined and steps are
 * recorded without calls.
 */
import path from 'node:path';
import type { RawCall } from './model/raw';

/** Methods (last part of the API name) that send input or run page code: they can cause interactions. */
const ACTIONS = new Set([
  'check', 'uncheck', 'setChecked', 'click', 'dblclick', 'tap', 'fill', 'clear', 'press', 'pressSequentially',
  'type', 'selectOption', 'selectText', 'setInputFiles', 'hover', 'dragTo', 'dragAndDrop', 'focus', 'blur',
  'dispatchEvent', 'down', 'up', 'move', 'wheel', 'insertText', 'evaluate', 'evaluateAll', 'evaluateHandle',
]);
/** Methods that load a page. */
const NAVIGATIONS = new Set(['goto', 'reload', 'goBack', 'goForward', 'setContent']);

/** How long after a call ended a step without a time can still be credited to it. */
const GRACE_MS = 500;
/** Clock granularity between the page and Node (same machine). */
const SLACK_MS = 5;
/** Calls kept for events that arrive late. */
const HISTORY = 50;

export type CallKind = 'action' | 'navigation';

interface Call {
  call: RawCall;
  selector?: string;
  kind: CallKind;
  begin: number;
  end?: number;
}

export interface CallTracker {
  /**
   * The call a step came from: an action for interactions (`at`: when the
   * event happened in the page, ms since the epoch), a navigation for loads.
   */
  current(kind: CallKind, at?: number): RawCall | undefined;
  dispose(): void;
}

/** A short argument that's safe to show (never typed text or values). */
function argOf(method: string, params: Record<string, unknown>): string | undefined {
  const v = method === 'goto' ? params.url : method === 'press' || method === 'keyboardPress' ? params.key : undefined;
  return typeof v === 'string' ? v.slice(0, 200) : undefined;
}

/**
 * Picks the call for a step from `calls` (in the order they began). With
 * `at`, the last call of `kind` that was in progress at that time; else the
 * last one in progress `now`, or the last one that ended within `GRACE_MS`.
 * A load is credited to a navigation only if it's the last call.
 */
export function pickCall<T extends Pick<Call, 'kind' | 'begin' | 'end'>>(
  calls: readonly T[],
  kind: CallKind,
  now: number,
  at?: number,
): T | undefined {
  if (at !== undefined) {
    // The call in progress at that time; allowing for clock granularity only if there's none.
    for (const slack of [0, SLACK_MS]) {
      for (let i = calls.length - 1; i >= 0; i--) {
        const c = calls[i];
        if (c.kind === kind && c.begin <= at + slack && (c.end === undefined || c.end >= at - slack)) return c;
      }
    }
    return undefined;
  }
  if (kind === 'navigation') {
    // A load comes from the last call only (a click after a goto that loads a page isn't the goto).
    const c = calls[calls.length - 1];
    return c?.kind === kind && (c.end === undefined || now - c.end <= GRACE_MS) ? c : undefined;
  }
  for (let i = calls.length - 1; i >= 0; i--) if (calls[i].kind === kind && calls[i].end === undefined) return calls[i];
  let last: T | undefined;
  for (const c of calls) if (c.kind === kind && c.end !== undefined && (!last || c.end >= last.end!)) last = c;
  return last && now - last.end! <= GRACE_MS ? last : undefined;
}

/**
 * Tracks the calls of `owner`'s Playwright connection (a browser context).
 * `formatLocator` turns a protocol selector into Playwright syntax.
 * `baseDir` makes spec locations relative.
 */
export function trackCalls(
  owner: unknown,
  opts: { formatLocator: (selector: string) => string | undefined; baseDir?: string },
): CallTracker | undefined {
  const instrumentation = (owner as any)?._instrumentation;
  if (typeof instrumentation?.addListener !== 'function' || typeof instrumentation?.removeListener !== 'function')
    return undefined;
  const calls: Call[] = [];
  const byZone = new WeakMap<object, Call>();

  const listener = {
    onApiCallBegin(zone: any, channel?: any) {
      try {
        const api = zone?.apiName;
        if (typeof api !== 'string' || typeof zone !== 'object') return;
        const method = api.slice(api.lastIndexOf('.') + 1);
        const kind = ACTIONS.has(method) ? 'action' : NAVIGATIONS.has(method) ? 'navigation' : undefined;
        if (!kind) return;
        // Params: on the zone up to 1.5x, in the second argument since.
        const params = (channel?.params ?? zone.params ?? {}) as Record<string, unknown>;
        const call: RawCall = { api };
        const arg = argOf(method, params);
        if (arg) call.arg = arg;
        const frame = Array.isArray(zone.frames) ? zone.frames[0] : undefined;
        if (frame && typeof frame.file === 'string' && typeof frame.line === 'number') {
          const file = opts.baseDir && path.isAbsolute(frame.file) ? path.relative(opts.baseDir, frame.file) : frame.file;
          call.file = file.split(path.sep).join('/');
          call.line = frame.line;
          if (typeof frame.column === 'number') call.column = frame.column;
        }
        const c: Call = { call, kind, begin: Date.now(), ...(typeof params.selector === 'string' ? { selector: params.selector } : {}) };
        calls.push(c);
        if (calls.length > HISTORY) calls.splice(0, calls.length - HISTORY);
        byZone.set(zone, c);
      } catch {
        /* unexpected shape: no call for this one */
      }
    },
    onApiCallEnd(zone: any) {
      const c = zone && typeof zone === 'object' ? byZone.get(zone) : undefined;
      if (c) c.end = Date.now();
    },
  };
  try {
    instrumentation.addListener(listener);
  } catch {
    return undefined;
  }

  /** The locator is rendered once, when a step uses the call. */
  const resolve = (c: Call): RawCall => {
    if (c.selector !== undefined && c.call.locator === undefined) {
      let locator: string | undefined;
      try {
        locator = opts.formatLocator(c.selector);
      } catch {
        /* keep the call without it */
      }
      c.call.locator = locator ?? '';
    }
    const { locator, ...rest } = c.call;
    return locator ? { ...rest, locator } : rest;
  };

  return {
    current(kind, at) {
      const now = Date.now();
      // A page time that isn't plausible (a mocked clock, a remote browser's clock): don't use it.
      const usable = at !== undefined && at <= now + SLACK_MS && at >= now - 60_000 ? at : undefined;
      const c = pickCall(calls, kind, now, usable);
      return c && resolve(c);
    },
    dispose() {
      calls.length = 0;
      try {
        instrumentation.removeListener(listener);
      } catch {
        /* nothing to undo */
      }
    },
  };
}
