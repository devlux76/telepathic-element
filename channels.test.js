import { test, expect, describe, beforeEach } from 'bun:test';
import { subscribe, unsubscribe, publish, reset } from './channels.js';

beforeEach(() => reset());

describe('channels', () => {
  test('subscribe receives published data', () => {
    let received = null;
    subscribe('test', (data) => { received = data; });
    publish('test', { hello: 'world' });
    expect(received).toEqual({ hello: 'world' });
  });

  test('unsubscribe stops delivery', () => {
    let count = 0;
    const unsub = subscribe('test', () => { count++; });
    publish('test', null);
    unsub();
    publish('test', null);
    expect(count).toBe(1);
  });

  test('multiple subscribers on same topic', () => {
    let a = 0, b = 0;
    subscribe('t', () => { a++; });
    subscribe('t', () => { b++; });
    publish('t', null);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  test('publish to empty topic is safe', () => {
    publish('nonexistent', null);
  });

  test('reset clears all channels', () => {
    let count = 0;
    subscribe('t', () => { count++; });
    reset();
    publish('t', null);
    expect(count).toBe(0);
  });

  test('handler error does not break other subscribers', () => {
    let ok = false;
    const origError = console.error;
    console.error = () => {}; // suppress expected error log
    try {
      subscribe('t', () => { throw new Error('bad'); });
      subscribe('t', () => { ok = true; });
      publish('t', null);
    } finally {
      console.error = origError;
    }
    expect(ok).toBe(true);
  });
});

describe('channels: dispatch semantics (audit regressions)', () => {
  test('a handler subscribed during publish is not called in that publish', () => {
    const calls = [];
    subscribe('t', () => {
      calls.push('first');
      subscribe('t', () => calls.push('late'));
    });
    publish('t', null);
    expect(calls).toEqual(['first']);
  });

  test('a handler that re-subscribes a new closure every time does not loop forever', () => {
    let n = 0;
    const handler = () => { n++; if (n > 1000) throw new Error('runaway'); subscribe('t', () => handler()); };
    subscribe('t', handler);
    publish('t', null);
    expect(n).toBe(1);
  });

  test('a handler unsubscribed by an earlier handler in the same publish is not called', () => {
    const calls = [];
    let unsubB;
    subscribe('t', () => { calls.push('a'); unsubB(); });
    unsubB = subscribe('t', () => calls.push('b'));
    publish('t', null);
    expect(calls).toEqual(['a']);
  });

  test('subscribe accepts an AbortSignal for cleanup', () => {
    let count = 0;
    const controller = new AbortController();
    subscribe('t', () => count++, { signal: controller.signal });
    publish('t', null);
    controller.abort();
    publish('t', null);
    expect(count).toBe(1);
  });

  test('subscribing with an already-aborted signal is a no-op', () => {
    let count = 0;
    subscribe('t', () => count++, { signal: AbortSignal.abort() });
    publish('t', null);
    expect(count).toBe(0);
  });
});
