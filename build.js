// build.js — bundles the runtime modules to dist/ as plain, minified ES
// modules (one file per module) and copies tokens.css.
//
//   bun run build            # -> dist/
//   bun run build.js <dir>   # -> <dir>
//
// Modules keep importing each other by relative path (./channels.js) instead
// of inlining a private copy, so dist/ws-client.js and dist/channels.js share
// one channel bus, exactly like the source files do.

import { rm, mkdir } from 'node:fs/promises';

const OUT = process.argv[2] ?? 'dist';
const entries = [
  'telepathic-element.js',
  'channels.js',
  'list.js',
  'markdown.js',
  'ws-client.js',
  'tokens.js',
];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const result = await Bun.build({
  entrypoints: entries.map((e) => `./${e}`),
  outdir: OUT,
  format: 'esm',
  target: 'browser',
  minify: true,
  // Sibling modules stay separate files, imported at runtime.
  external: entries.map((e) => `./${e}`),
});

if (!result.success) {
  for (const msg of result.logs) console.error(msg);
  process.exit(1);
}

await Bun.write(`${OUT}/tokens.css`, Bun.file('tokens.css'));

for (const output of result.outputs) {
  console.log(`${output.path.split('/').pop().padEnd(24)} ${output.size} bytes`);
}
console.log(`Build complete -> ${OUT}/`);
