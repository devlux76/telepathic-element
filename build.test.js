import { test, expect, describe, beforeAll } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Build into a temp dir exactly as `bun run build` does into dist/.
const out = mkdtempSync(join(tmpdir(), 'telepathic-dist-'));
beforeAll(async () => {
  const proc = Bun.spawn(['bun', 'run', 'build.js', out], { cwd: import.meta.dir, stdout: 'pipe', stderr: 'pipe' });
  const code = await proc.exited;
  if (code !== 0) throw new Error(await new Response(proc.stderr).text());
});

describe('build output', () => {
  test('emits every runtime module plus tokens.css', () => {
    expect(readdirSync(out).sort()).toEqual([
      'channels.js', 'list.js', 'markdown.js', 'telepathic-element.js', 'tokens.css', 'tokens.js', 'ws-client.js',
    ]);
  });

  test('dist modules import only each other (zero runtime dependencies)', () => {
    for (const file of readdirSync(out).filter(f => f.endsWith('.js'))) {
      const src = readFileSync(join(out, file), 'utf8');
      for (const [, spec] of src.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g)) {
        expect(spec).toMatch(/^\.\/[\w-]+\.js$/);
      }
    }
  });

  test('dist/ws-client.js publishes on the same bus as dist/channels.js', async () => {
    const channels = await import(join(out, 'channels.js'));
    const { createWsClient } = await import(join(out, 'ws-client.js'));
    const sockets = [];
    globalThis.WebSocket = class { static OPEN = 1; readyState = 1; constructor() { sockets.push(this); } close() {} };
    try {
      const seen = [];
      channels.subscribe('chat', (d) => seen.push(d));
      const client = createWsClient('ws://x');
      client.connect();
      sockets[0].onmessage({ data: JSON.stringify({ topic: 'chat', data: 'hello' }) });
      expect(seen).toEqual(['hello']);
      client.disconnect();
    } finally {
      globalThis.WebSocket = undefined;
    }
  });

  test('dist tokens.css matches the source', () => {
    expect(readFileSync(join(out, 'tokens.css'), 'utf8')).toBe(readFileSync(join(import.meta.dir, 'tokens.css'), 'utf8'));
  });
});
