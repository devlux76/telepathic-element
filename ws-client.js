// ws-client.js — WebSocket client factory: createWsClient(url, token)
// Per-instance connect/disconnect/send/subscribe with auto-reconnect
// (exponential backoff + jitter), a keepalive ping, and inbound {topic, data}
// frames published onto the shared channel bus. Zero dependencies.
//
// Channel topics published by every client:
//   <topic>      data of an inbound JSON frame { topic, data }
//   ws:message   every inbound frame (parsed JSON, or the raw string)
//   ws:open      null
//   ws:close     { code, reason }
//   ws:error     the error event

import { publish, subscribe as channelSubscribe } from './channels.js';

const INITIAL_DELAY = 1000;
const MAX_DELAY = 30000;
const HEARTBEAT_INTERVAL = 30000;

export function createWsClient(initialUrl = '', initialToken = '') {
  let ws = null;
  let reconnectDelay = INITIAL_DELAY;
  let heartbeatTimer = null;
  let reconnectTimer = null;
  let url = initialUrl;
  let token = initialToken;

  // Full jitter in [delay/2, delay] so many clients do not reconnect in lockstep.
  const jitter = (delay) => delay * (0.5 + Math.random() * 0.5);

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => send({ type: 'ping' }), HEARTBEAT_INTERVAL);
  }

  function stopHeartbeat() {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function cancelReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, jitter(reconnectDelay));
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY);
  }

  // Close the current socket without letting its late events reach us.
  function retire() {
    if (!ws) return;
    const old = ws;
    ws = null;
    old.onopen = old.onmessage = old.onerror = old.onclose = null;
    try { old.close(); } catch { /* already closed */ }
  }

  function open() {
    retire();
    let wsUrl = url;
    if (token) wsUrl += (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
    const socket = new WebSocket(wsUrl);
    ws = socket;

    socket.onopen = () => {
      reconnectDelay = INITIAL_DELAY;
      startHeartbeat();
      publish('ws:open', null);
    };
    socket.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { msg = event.data; }
      if (msg !== null && typeof msg === 'object' && msg.topic) publish(msg.topic, msg.data ?? msg);
      publish('ws:message', msg);
    };
    socket.onerror = (err) => publish('ws:error', err);
    socket.onclose = (event) => {
      if (ws !== socket) return;
      ws = null;
      stopHeartbeat();
      publish('ws:close', { code: event.code, reason: event.reason });
      scheduleReconnect();
    };
    return socket;
  }

  /** (Re)connect. Arguments override the url/token given to createWsClient. */
  function connect(connectUrl, connectToken) {
    url = connectUrl ?? url;
    token = connectToken ?? token;
    cancelReconnect();
    stopHeartbeat();
    return open();
  }

  /** Close the socket and stop reconnecting. */
  function disconnect() {
    cancelReconnect();
    stopHeartbeat();
    retire();
  }

  /** Send a string or a JSON-serialisable value. Returns false if not open. */
  function send(data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(typeof data === 'string' ? data : JSON.stringify(data));
    return true;
  }

  function subscribe(topic, handler, options) {
    return channelSubscribe(topic, handler, options);
  }

  return { connect, disconnect, send, subscribe };
}

// A default client for apps that need only one connection.
const defaultClient = createWsClient();
export const { connect, disconnect, send, subscribe } = defaultClient;
