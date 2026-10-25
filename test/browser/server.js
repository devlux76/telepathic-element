// test/browser/server.js — static file server for the repo root plus a test
// WebSocket endpoint. Used by `bun run test:browser` and for manual runs:
//
//   bun run serve            # http://localhost:8037/test/browser/  and  /examples/
//
// WebSocket /ws protocol (for the ws-client browser tests):
//   {"cmd":"echo-topic","topic":T,"data":D}  -> server sends {"topic":T,"data":D}
//   {"cmd":"drop"}                            -> server closes the socket (code 4001)
//   anything else                             -> ignored (e.g. heartbeat pings)

import { resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dir, '../..');

export function startServer({ port = 0, onResults } = {}) {
  return Bun.serve({
    port,
    hostname: '127.0.0.1',
    async fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === '/ws') {
        return server.upgrade(req, { data: { token: url.searchParams.get('token') } })
          ? undefined
          : new Response('upgrade failed', { status: 400 });
      }
      if (url.pathname === '/__results' && req.method === 'POST') {
        onResults?.(await req.json());
        return new Response('ok');
      }
      let path = decodeURIComponent(url.pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = resolve(ROOT, '.' + path);
      if (file !== ROOT && !file.startsWith(ROOT + sep)) return new Response('forbidden', { status: 403 });
      const body = Bun.file(file);
      if (!(await body.exists())) return new Response('not found', { status: 404 });
      return new Response(body, { headers: { 'cache-control': 'no-store' } });
    },
    websocket: {
      open(ws) {
        ws.send(JSON.stringify({ topic: 'server:hello', data: { token: ws.data.token } }));
      },
      message(ws, raw) {
        let msg;
        try { msg = JSON.parse(String(raw)); } catch { return; }
        if (msg.cmd === 'echo-topic') ws.send(JSON.stringify({ topic: msg.topic, data: msg.data }));
        else if (msg.cmd === 'drop') ws.close(4001, 'dropped by test');
      },
    },
  });
}

if (import.meta.main) {
  const server = startServer({ port: Number(process.env.PORT ?? 8037) });
  console.log(`Serving ${ROOT}`);
  console.log(`  tests:    ${server.url}test/browser/`);
  console.log(`  examples: ${server.url}examples/`);
}
