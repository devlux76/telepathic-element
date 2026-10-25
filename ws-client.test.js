import { test, expect, describe, beforeEach, afterEach, jest } from 'bun:test';
import { subscribe, reset } from './channels.js';
import * as wsClient from './ws-client.js';
import { createWsClient } from './ws-client.js';

// A controllable WebSocket double. Like the real thing, close() is
// asynchronous: the close event arrives on a later task.
let sockets = [];
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen = null;
  onmessage = null;
  onclose = null;
  onerror = null;
  sent = [];

  constructor(url) {
    this.url = url;
    sockets.push(this);
  }

  // test helpers
  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({ type: 'open' });
  }
  serverClose(code = 1006, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ type: 'close', code, reason });
  }
  receive(data) {
    this.onmessage?.({ type: 'message', data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  send(data) {
    if (this.readyState !== MockWebSocket.OPEN) throw new Error('InvalidStateError');
    this.sent.push(data);
  }
  close(code = 1000, reason = '') {
    if (this.readyState >= MockWebSocket.CLOSING) return;
    this.readyState = MockWebSocket.CLOSING;
    setTimeout(() => this.serverClose(code, reason), 0);
  }
}

beforeEach(() => {
  reset();
  sockets = [];
  globalThis.WebSocket = MockWebSocket;
  jest.useFakeTimers();
});

afterEach(() => {
  wsClient.disconnect();
  jest.useRealTimers();
  globalThis.WebSocket = undefined;
});

const collect = (topic) => {
  const seen = [];
  subscribe(topic, (d) => seen.push(d));
  return seen;
};

describe('inbound frames', () => {
  test('a {topic, data} frame is published on that topic and on ws:message', () => {
    const client = createWsClient('ws://h');
    const chat = collect('chat');
    const all = collect('ws:message');
    client.connect();
    sockets[0].open();
    sockets[0].receive({ topic: 'chat', data: { text: 'hi' } });
    expect(chat).toEqual([{ text: 'hi' }]);
    expect(all).toEqual([{ topic: 'chat', data: { text: 'hi' } }]);
    client.disconnect();
  });

  test('non-JSON and JSON null frames arrive on ws:message unchanged', () => {
    const client = createWsClient('ws://h');
    const all = collect('ws:message');
    client.connect();
    sockets[0].open();
    sockets[0].receive('plain text');
    sockets[0].receive('null');
    expect(all).toEqual(['plain text', null]);
    client.disconnect();
  });

  test('ws:open and ws:close are published', () => {
    const client = createWsClient('ws://h');
    const opened = collect('ws:open');
    const closed = collect('ws:close');
    client.connect();
    sockets[0].open();
    sockets[0].serverClose(4000, 'bye');
    expect(opened.length).toBe(1);
    expect(closed).toEqual([{ code: 4000, reason: 'bye' }]);
    client.disconnect();
  });
});

describe('reconnect with backoff', () => {
  test('an unexpected close reconnects after a jittered, doubling delay that resets on open', () => {
    const client = createWsClient('ws://h');
    client.connect();
    sockets[0].open();

    sockets[0].serverClose();             // drop #1: delay in [500, 1000]
    jest.advanceTimersByTime(499);
    expect(sockets.length).toBe(1);
    jest.advanceTimersByTime(501);
    expect(sockets.length).toBe(2);

    sockets[1].serverClose();             // fails before opening: delay in [1000, 2000]
    jest.advanceTimersByTime(999);
    expect(sockets.length).toBe(2);
    jest.advanceTimersByTime(1001);
    expect(sockets.length).toBe(3);

    sockets[2].open();                    // success resets the delay
    sockets[2].serverClose();
    jest.advanceTimersByTime(1000);
    expect(sockets.length).toBe(4);
    client.disconnect();
  });

  test('the delay is capped at 30s', () => {
    const client = createWsClient('ws://h');
    client.connect();
    for (let i = 0; i < 10; i++) {
      sockets.at(-1).serverClose();
      jest.advanceTimersByTime(30000);
    }
    const before = sockets.length;
    sockets.at(-1).serverClose();
    jest.advanceTimersByTime(30000);
    expect(sockets.length).toBe(before + 1);
    client.disconnect();
  });

  test('connect() while connected replaces the socket without a reconnect storm', () => {
    const client = createWsClient('ws://h');
    client.connect();
    sockets[0].open();
    client.connect();                     // e.g. new token
    sockets[1].open();
    jest.advanceTimersByTime(120000);     // old socket's close event fires meanwhile
    expect(sockets.length).toBe(2);
    expect(sockets[1].readyState).toBe(MockWebSocket.OPEN);
    client.disconnect();
  });

  test('connect() while a reconnect is pending cancels the pending reconnect', () => {
    const client = createWsClient('ws://h');
    client.connect();
    sockets[0].serverClose();             // schedules a reconnect
    client.connect();                     // manual reconnect now
    sockets[1].open();
    jest.advanceTimersByTime(120000);
    expect(sockets.length).toBe(2);
    expect(sockets[1].readyState).toBe(MockWebSocket.OPEN);
    client.disconnect();
  });

  test('frames from a replaced socket are ignored', () => {
    const client = createWsClient('ws://h');
    const chat = collect('chat');
    client.connect();
    const old = sockets[0];
    old.open();
    client.connect();
    old.receive({ topic: 'chat', data: 'stale' });
    expect(chat).toEqual([]);
    client.disconnect();
  });

  test('disconnect() cancels reconnects and the heartbeat', () => {
    const client = createWsClient('ws://h');
    client.connect();
    sockets[0].open();
    sockets[0].serverClose();             // reconnect pending
    client.disconnect();
    jest.advanceTimersByTime(120000);
    expect(sockets.length).toBe(1);
  });
});

describe('heartbeat', () => {
  test('pings every 30s while open and stops after close', () => {
    const client = createWsClient('ws://h');
    client.connect();
    sockets[0].open();
    jest.advanceTimersByTime(90000);
    expect(sockets[0].sent).toEqual(Array(3).fill('{"type":"ping"}'));
    client.disconnect();
    jest.advanceTimersByTime(90000);
    expect(sockets[0].sent.length).toBe(3);
  });
});

describe('send', () => {
  test('returns true when sent, false when there is no open socket', () => {
    const client = createWsClient('ws://h');
    expect(client.send({ a: 1 })).toBe(false);
    client.connect();
    expect(client.send('early')).toBe(false);
    sockets[0].open();
    expect(client.send({ a: 1 })).toBe(true);
    expect(client.send('raw')).toBe(true);
    expect(sockets[0].sent).toEqual(['{"a":1}', 'raw']);
    client.disconnect();
  });
});

describe('connect() URL and token', () => {
  test('appends ?token= for a plain URL', () => {
    wsClient.connect('ws://localhost:8080', 'a b&c');
    expect(sockets[0].url).toBe('ws://localhost:8080?token=a%20b%26c');
  });

  test('appends &token= for a URL that already has query params', () => {
    wsClient.connect('ws://localhost:8080?foo=bar', 'abc123');
    expect(sockets[0].url).toBe('ws://localhost:8080?foo=bar&token=abc123');
  });

  test('no token parameter when the token is empty', () => {
    wsClient.connect('ws://localhost:8080', '');
    expect(sockets[0].url).toBe('ws://localhost:8080');
  });

  test('factory url/token are used by connect() and by reconnects', () => {
    const client = createWsClient('ws://pre.example.com', 'pretoken');
    client.connect();
    sockets[0].serverClose();
    jest.advanceTimersByTime(1000);
    expect(sockets.map(s => s.url)).toEqual([
      'ws://pre.example.com?token=pretoken',
      'ws://pre.example.com?token=pretoken',
    ]);
    client.disconnect();
  });

  test('two clients keep independent sockets', () => {
    const a = createWsClient('ws://a');
    const b = createWsClient('ws://b');
    a.connect(); b.connect();
    sockets[0].open(); sockets[1].open();
    a.disconnect();
    expect(b.send('still here')).toBe(true);
    b.disconnect();
  });

  test('client.subscribe is synchronous and returns an unsubscribe function', () => {
    const off = wsClient.subscribe('t', () => {});
    expect(off).toBeTypeOf('function');
  });
});
