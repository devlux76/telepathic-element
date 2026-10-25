// test/browser/run.js — runs test/browser/index.html in headless Chrome and
// reports the results. `bun run test:browser`. Exit code 0 = all passed.
//
// The page POSTs its results to the server when it finishes; the timeout
// below is only a backstop for a page that never reports (it fails the run).
// Set CHROME_BIN to use another Chrome/Chromium binary.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './server.js';

const CHROME = process.env.CHROME_BIN ?? '/usr/bin/google-chrome';
const BACKSTOP_MS = 60000;

let report;
const reported = new Promise((resolve) => { report = resolve; });
const server = startServer({ onResults: report });
const profile = mkdtempSync(join(tmpdir(), 'telepathic-chrome-'));
const pageUrl = `${server.url}test/browser/index.html`;

console.log(`Chrome: ${CHROME}`);
console.log(`Page:   ${pageUrl}`);

const chrome = Bun.spawn([
  CHROME,
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--disable-extensions',
  `--user-data-dir=${profile}`,
  pageUrl,
], { stdout: 'ignore', stderr: 'ignore' });

let backstop;
const result = await Promise.race([
  reported,
  chrome.exited.then((code) => ({ crashed: `Chrome exited (code ${code}) before reporting` })),
  new Promise((resolve) => { backstop = setTimeout(() => resolve({ crashed: `no report within ${BACKSTOP_MS} ms` }), BACKSTOP_MS); }),
]);
clearTimeout(backstop);

chrome.kill();
await chrome.exited;
server.stop(true);
rmSync(profile, { recursive: true, force: true });

if (result.crashed) {
  console.error(`FAIL: ${result.crashed}`);
  process.exit(1);
}

console.log(`Browser: ${result.userAgent}\n`);
let failed = 0;
for (const r of result.results) {
  console.log(`${r.ok ? 'pass' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.error.replaceAll('\n', '\n      ')}`}`);
  if (!r.ok) failed++;
}
for (const e of result.errors ?? []) console.log(`page error: ${e}`);
console.log(`\n${result.results.length - failed} pass, ${failed} fail`);
process.exit(failed || result.errors?.length ? 1 : 0);
