import { describe, expect, it } from 'vitest';
import { inputGate } from '../src/input-gate';

/** A stand-in for Playwright's client connection: records the order calls reach the "server". */
function fakeConnection() {
  const log: string[] = [];
  const pending = new Map<string, () => void>();
  const connection = {
    sendMessageToServer(object: { _type: string; name: string }, method: string) {
      log.push(`send ${object.name}.${method}`);
      return new Promise<string>((resolve) => pending.set(`${object.name}.${method}`, () => resolve(method)));
    },
  };
  const reply = (call: string) => {
    pending.get(call)!();
    pending.delete(call);
  };
  return { connection, log, reply };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('input gate', () => {
  const setup = () => {
    const fake = fakeConnection();
    const page = { _type: 'Page', name: 'page', _connection: fake.connection };
    const frame = { _type: 'Frame', name: 'frame', _page: page };
    const other = { _type: 'Page', name: 'other' };
    const gate = inputGate(page)!;
    const send = (object: object, method: string) => (fake.connection as any).sendMessageToServer(object, method);
    return { ...fake, page, frame, other, gate, send };
  };

  it('installs once per connection and passes other calls straight through', () => {
    const { page, gate, send, log } = setup();
    expect(inputGate({ _connection: page._connection })).toBe(gate);
    void send(page, 'screenshot');
    void send(page, 'mouseWheel');
    expect(log).toEqual(['send page.screenshot', 'send page.mouseWheel']); // synchronous when nothing is captured
  });

  it('holds input to the page while its full-page capture runs', async () => {
    const { page, frame, other, gate, send, log } = setup();
    let finishCapture!: () => void;
    const capture = gate.exclusive(page, () => new Promise<void>((r) => (finishCapture = r)));
    await tick();
    const wheel = send(page, 'mouseWheel');
    const click = send(frame, 'click');
    void send(other, 'mouseWheel'); // another page isn't held up
    void send(page, 'evaluateExpression'); // not input
    await tick();
    expect(log).toEqual(['send other.mouseWheel', 'send page.evaluateExpression']);
    finishCapture();
    await capture;
    await tick();
    expect(log).toEqual(['send other.mouseWheel', 'send page.evaluateExpression', 'send page.mouseWheel', 'send frame.click']);
    void wheel;
    void click;
  });

  it('starts a capture only once the input in flight is done', async () => {
    const { page, frame, gate, send, log, reply } = setup();
    const click = send(frame, 'click');
    let started = false;
    const capture = gate.exclusive(page, async () => {
      started = true;
    });
    await tick();
    expect(started).toBe(false);
    reply('frame.click');
    expect(await click).toBe('click');
    await capture;
    expect(started).toBe(true);
    expect(log).toEqual(['send frame.click']);
  });

  it('passes errors through and counts failed calls as done', async () => {
    const page = {
      _type: 'Page',
      _connection: { sendMessageToServer: () => Promise.reject(new Error('Target closed')) },
    };
    const gate = inputGate(page)!;
    await expect((page._connection as any).sendMessageToServer(page, 'mouseMove')).rejects.toThrow('Target closed');
    let ran = false;
    await gate.exclusive(page, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it('is undefined without the private connection', () => {
    expect(inputGate({})).toBeUndefined();
  });
});
