/**
 * Keeps the recorder's full-page screenshots and the test's own input apart.
 *
 * In Chromium, a full-page screenshot (`Page.captureScreenshot` with
 * `captureBeyondViewport`) temporarily resizes the viewport to the whole
 * document. Input dispatched while that capture is in progress can get lost:
 * a mouse wheel over a scrollable element doesn't scroll it, and a click in
 * an out-of-process iframe sometimes doesn't arrive. The recorder captures
 * while the test keeps running, so without this a test step could fail now and
 * then only because it is being recorded (issue #42).
 *
 * The gate sits on the client connection's `sendMessageToServer`, the one
 * place every API call passes through after Playwright has reported it (so
 * steps, call locations and traces stay exactly as they are):
 *
 * - an input call (click, fill, hover, mouse.wheel, keyboard.press, ...) to a
 *   page whose full-page capture is in progress waits until the capture ends;
 * - a full-page capture waits until the page's input calls in flight are done
 *   (at most `IDLE_WAIT` ms, so a click stuck waiting for actionability
 *   doesn't hold up recording).
 *
 * The connection is shared by every object in the worker, so this works the
 * same in fixture and register mode. It's a private API: when it isn't there,
 * the gate does nothing and captures run as before.
 */

/** Protocol methods that dispatch real input (they go through the browser's input pipeline). */
const PAGE_INPUT = [
  'keyboardDown',
  'keyboardUp',
  'keyboardInsertText',
  'keyboardType',
  'keyboardPress',
  'mouseMove',
  'mouseDown',
  'mouseUp',
  'mouseClick',
  'mouseWheel',
  'touchscreenTap',
];
const ELEMENT_INPUT = ['check', 'uncheck', 'click', 'dblclick', 'tap', 'hover', 'press', 'type', 'fill', 'dragAndDrop'];
const INPUT_METHODS: Record<string, Set<string>> = {
  Page: new Set(PAGE_INPUT),
  Frame: new Set(ELEMENT_INPUT),
  ElementHandle: new Set(ELEMENT_INPUT),
};

/** How long a capture waits for input calls in flight before it goes ahead anyway. */
const IDLE_WAIT = 3000;

/** Input calls in flight for elements whose page isn't known (element handles). */
const ANY_PAGE = Symbol('any page');
type PageKey = object | typeof ANY_PAGE;

class Gate {
  /** Full-page captures in progress, per page (client object). Resolve when done; never reject. */
  private captures = new Map<object, Promise<void>>();
  /** Input calls in flight, per page. */
  private inputs = new Map<PageKey, number>();
  /** Captures waiting for a page's inputs to finish. */
  private idleWaiters = new Set<() => void>();

  /** Wraps one `sendMessageToServer` call. */
  send(object: any, method: string, run: () => Promise<unknown>): Promise<unknown> {
    if (!INPUT_METHODS[object?._type]?.has(method)) return run();
    const page: PageKey = object._type === 'Page' ? object : object._type === 'Frame' && object._page ? object._page : ANY_PAGE;
    const blocking =
      page === ANY_PAGE
        ? this.captures.size
          ? Promise.all(this.captures.values())
          : undefined
        : this.captures.get(page);
    // Counted before waiting, so no new capture starts until this call is done.
    this.inputs.set(page, (this.inputs.get(page) ?? 0) + 1);
    // No capture in progress (almost always): send right away, synchronously, as before.
    const result = blocking ? blocking.then(run) : run();
    const done = () => {
      const n = (this.inputs.get(page) ?? 1) - 1;
      if (n > 0) this.inputs.set(page, n);
      else this.inputs.delete(page);
      this.idleWaiters.forEach((wake) => wake());
    };
    result.then(done, done);
    return result;
  }

  private busy(page: object) {
    return (this.inputs.get(page) ?? 0) > 0 || (this.inputs.get(ANY_PAGE) ?? 0) > 0;
  }

  /** Resolves when `page` has no input in flight, or after `ms`. */
  private idle(page: object, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.idleWaiters.delete(wake);
        resolve();
      };
      const wake = () => {
        if (!this.busy(page)) finish();
      };
      const timer = setTimeout(finish, ms);
      this.idleWaiters.add(wake);
    });
  }

  /** Runs `capture` (a full-page screenshot of `page`) with no input to that page in flight. */
  async exclusive<T>(page: object, capture: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + IDLE_WAIT;
    for (;;) {
      const other = this.captures.get(page);
      if (other) await other;
      else if (this.busy(page) && Date.now() < deadline) await this.idle(page, deadline - Date.now());
      else break;
    }
    let release!: () => void;
    this.captures.set(page, new Promise<void>((resolve) => (release = resolve)));
    try {
      return await capture();
    } finally {
      this.captures.delete(page);
      release();
    }
  }
}

const GATES = Symbol.for('playwright-ui-coverage.inputGate');

/**
 * The gate of the connection `owner` (a page, context, ...) talks through,
 * installed on first use. Undefined when the private API isn't there.
 */
export function inputGate(owner: unknown): Gate | undefined {
  const connection = (owner as any)?._connection;
  if (!connection || typeof connection.sendMessageToServer !== 'function') return undefined;
  if (connection[GATES]) return connection[GATES];
  const gate = new Gate();
  const original = connection.sendMessageToServer;
  connection.sendMessageToServer = function (this: unknown, object: unknown, method: string, ...rest: unknown[]) {
    return gate.send(object, method, () => original.call(this, object, method, ...rest));
  };
  connection[GATES] = gate;
  return gate;
}

export type { Gate as InputGate };
