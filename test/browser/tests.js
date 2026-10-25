// Real-browser tests: custom elements, shadow DOM, adoptedStyleSheets,
// constructable stylesheets, real events, real WebSocket, and the examples.
// Results are shown on the page, exposed as window.__results, and POSTed to
// /__results for `bun run test:browser`.

import { TelepathicElement, DataBind } from '../../telepathic-element.js';
import { cssText, tokenSheet, applyTokens } from '../../tokens.js';
import { subscribe, publish } from '../../channels.js';
import { KeyedList } from '../../list.js';
import { MarkdownRenderer } from '../../markdown.js';
import { createWsClient } from '../../ws-client.js';

const results = [];
const errors = [];
addEventListener('error', (e) => errors.push(String(e.error?.stack ?? e.message)));
addEventListener('unhandledrejection', (e) => errors.push(`unhandled rejection: ${e.reason?.stack ?? e.reason}`));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}
function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`);
}

// Resolve when check() is truthy, re-checking on DOM mutations under root.
// The timeout is only a backstop that turns a hang into a failure.
function waitFor(check, root = document, ms = 5000) {
  return new Promise((resolve, reject) => {
    const done = check();
    if (done) return resolve(done);
    const observer = new MutationObserver(() => {
      const value = check();
      if (value) { observer.disconnect(); clearTimeout(timer); resolve(value); }
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('waitFor: timed out')); }, ms);
  });
}

// Resolve with the next publish on a channel topic.
function next(topic, ms = 5000) {
  return new Promise((resolve, reject) => {
    const off = subscribe(topic, (data) => { off(); clearTimeout(timer); resolve(data); });
    const timer = setTimeout(() => { off(); reject(new Error(`no "${topic}" within ${ms} ms`)); }, ms);
  });
}

const sandbox = document.getElementById('sandbox');
let seq = 0;
function define(Cls) {
  const tag = `bt-el-${++seq}`;
  customElements.define(tag, Cls);
  return tag;
}
async function mount(Cls, setup) {
  const el = document.createElement(define(Cls));
  setup?.(el);
  sandbox.append(el);
  await el.ready;
  return el;
}

// ---------------------------------------------------------------------------
// Core: custom elements + shadow DOM + binding
// ---------------------------------------------------------------------------

test('custom element upgrades, attaches an open shadow root and stamps the template', async () => {
  const el = await mount(class extends TelepathicElement {
    static template = '<p id="p">Hi ${this.name}</p>';
  }, (e) => { e.name = 'there'; });
  assert(el instanceof TelepathicElement, 'not upgraded');
  assert(el.shadowRoot && el.$ === el.shadowRoot, 'no open shadow root');
  eq(el.shadowRoot.mode, 'open');
  eq(el.p.textContent, 'Hi there');
  assert(document.querySelector('#p') === null, 'template content leaked into the light DOM');
});

test('multiple tags in one text node, attribute and class bindings update', async () => {
  const el = await mount(class extends TelepathicElement {
    static template = '<p id="p" title="${this.tip}" class="${this.cls}">${this.a} and ${this.b}, ${this.a}</p>';
  });
  el.a = 'A'; el.b = 'B'; el.tip = 'tip'; el.cls = 'one two';
  eq(el.p.textContent, 'A and B, A');
  eq(el.p.getAttribute('title'), 'tip');
  eq([...el.p.classList], ['one', 'two']);
  el.cls = 'three';
  eq([...el.p.classList], ['three']);
});

test('default binding is text: HTML in a value is not parsed or executed', async () => {
  window.__xss = 0;
  const el = await mount(class extends TelepathicElement {
    static template = '<p id="p">${this.v}</p><div id="h" data-bind-html="${this.html}"></div>';
  });
  el.v = '<img src=x onerror="window.__xss++">';
  el.html = '<b>bold</b>';
  await new Promise((r) => setTimeout(r, 50)); // give a would-be onerror a chance to run
  eq(el.p.querySelector('img'), null, 'img element created from text binding');
  eq(window.__xss, 0, 'onerror executed');
  eq(el.h.querySelector('b')?.textContent, 'bold', 'data-bind-html opt-in');
});

test('two-way: typing into an input updates the property and other bindings', async () => {
  const el = await mount(class extends TelepathicElement {
    static template = '<input id="i" value="${this.msg}"><span id="s">${this.msg}</span>';
  }, (e) => { e.msg = 'start'; });
  eq(el.i.value, 'start');
  el.i.focus();
  el.i.select();
  document.execCommand('insertText', false, 'typed'); // real editing -> real input event
  eq(el.msg, 'typed');
  eq(el.s.textContent, 'typed');
});

test('two-way: clicking a bound checkbox updates the boolean property', async () => {
  const el = await mount(class extends TelepathicElement {
    static template = '<input id="c" type="checkbox" checked="${this.done}"><span id="s">${this.done}</span>';
  }, (e) => { e.done = false; });
  eq(el.c.checked, false, 'false must render unchecked');
  el.c.click();
  eq(el.done, true);
  eq(el.s.textContent, 'true');
  el.done = false;
  eq(el.c.checked, false, 'programmatic false after user interaction');
});

test('bindings keep working after the element is moved (disconnect + reconnect)', async () => {
  const el = await mount(class extends TelepathicElement {
    static template = '<p id="p">${this.msg}</p>';
  });
  const signal = el.signal;
  const other = document.createElement('section');
  sandbox.append(other);
  other.append(el);
  assert(signal.aborted, 'signal not aborted on disconnect');
  assert(el.signal && !el.signal.aborted, 'signal not renewed on reconnect');
  el.msg = 'moved';
  eq(el.p.textContent, 'moved');
});

test('nested light-DOM component binds its own content; the outer one does not steal it', async () => {
  const innerTag = define(class extends TelepathicElement {
    static shadow = false;
    static delayRender = true; // stamped now, bound later by its own render()
    static template = '<b id="inner-b">${this.label}</b>';
  });
  const outer = await mount(class extends TelepathicElement {
    static template = `<${innerTag} id="child"></${innerTag}><i id="outer-i">\${this.label}</i>`;
  });
  const inner = outer.child;
  await inner.ready;
  outer.render(); // outer re-renders while the inner's ${} is still unbound
  inner.render();
  outer.label = 'outer';
  inner.label = 'inner';
  eq(outer.$.querySelector('#outer-i').textContent, 'outer');
  eq(inner.querySelector('#inner-b').textContent, 'inner');
});

test('static styles and adoptStyleSheet() apply via adoptedStyleSheets', async () => {
  const global = new CSSStyleSheet();
  global.replaceSync('p { font-style: italic; }');
  TelepathicElement.adoptStyleSheet(global);
  const own = new CSSStyleSheet();
  own.replaceSync('p { color: rgb(1, 2, 3); }');
  const el = await mount(class extends TelepathicElement {
    static styles = [own];
    static template = '<p id="p">styled</p>';
  });
  assert(el.shadowRoot.adoptedStyleSheets.includes(own), 'own sheet not adopted');
  assert(el.shadowRoot.adoptedStyleSheets.includes(global), 'global sheet not adopted');
  eq(getComputedStyle(el.p).color, 'rgb(1, 2, 3)');
  eq(getComputedStyle(el.p).fontStyle, 'italic');
  // shadow styles must not leak out
  const outside = sandbox.appendChild(document.createElement('p'));
  assert(getComputedStyle(outside).color !== 'rgb(1, 2, 3)', 'shadow style leaked');
  outside.remove();
});

test('DataBind works standalone on a plain object', () => {
  const state = { n: 1 };
  const span = document.createElement('span');
  new DataBind({ object: state, property: 'n' }).bindElement(span, 'textContent');
  state.n = 2;
  eq(span.textContent, '2');
});

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

test('tokens: applyTokens(shadowRoot) defines the custom properties inside the component', async () => {
  const el = await mount(class extends TelepathicElement {
    static template = '<p id="p">t</p>';
    constructor() { super(); applyTokens(this.$); }
  });
  assert(tokenSheet instanceof CSSStyleSheet, 'no constructable sheet');
  const value = getComputedStyle(el.p).getPropertyValue('--space-4').trim();
  eq(value, '1rem');
});

test('tokens: control — a :root-only sheet defines nothing inside a shadow root (the old bug)', async () => {
  const rootOnly = new CSSStyleSheet();
  rootOnly.replaceSync(cssText.replaceAll(':root, :host', ':root'));
  const el = await mount(class extends TelepathicElement {
    static styles = [rootOnly];
    static template = '<p id="p">t</p>';
  });
  eq(getComputedStyle(el.p).getPropertyValue('--space-4').trim(), '');
});

// ---------------------------------------------------------------------------
// channels, list, markdown
// ---------------------------------------------------------------------------

test('channels: subscribe with a component signal unsubscribes on disconnect', async () => {
  const seen = [];
  const el = await mount(class extends TelepathicElement {
    static template = '<p></p>';
    connectedCallback() {
      super.connectedCallback();
      subscribe('bt:topic', (d) => seen.push(d), { signal: this.signal });
    }
  });
  publish('bt:topic', 1);
  el.remove();
  publish('bt:topic', 2);
  eq(seen, [1]);
});

test('KeyedList: upsert/remove/clear in a real DOM', () => {
  const ul = document.createElement('ul');
  const header = ul.appendChild(document.createElement('li'));
  const list = new KeyedList(ul, (m) => m.id, (m) => Object.assign(document.createElement('li'), { textContent: m.text }));
  list.append({ id: 1, text: 'one' });
  list.append({ id: 2, text: 'two' });
  list.update({ id: 1, text: 'uno' });
  list.append({ id: 2, text: 'dos' });
  eq([...ul.children].slice(1).map((li) => li.textContent), ['uno', 'dos']);
  list.clear();
  eq([...ul.children], [header]);
});

test('markdown: XSS payloads stay inert in a live document', async () => {
  window.__pwned = 0;
  const box = sandbox.appendChild(document.createElement('div'));
  const md = new MarkdownRenderer(box);
  md.render([
    '<img src=x onerror="window.__pwned++">',
    '[x](javascript:window.__pwned++)',
    '[x](https://ok.example/" onmouseover="window.__pwned++)',
    '```"><img src=x onerror="window.__pwned++">',
    '<svg onload="window.__pwned++"></svg>',
    '```',
    '| <iframe src="javascript:window.__pwned++"> |',
    '|---|',
  ].join('\n'));
  await new Promise((r) => setTimeout(r, 100));
  eq(window.__pwned, 0, 'payload executed');
  eq(box.querySelectorAll('img, svg, iframe, script').length, 0);
  for (const a of box.querySelectorAll('a')) assert(/^https:/.test(a.href), `unsafe href ${a.href}`);
  box.remove();
});

test('markdown: streaming one character at a time matches whole-document render', () => {
  const doc = '# T\n\nSome **bold** and `code`.\n\n```js\nlet x = 1;\n\nx++;\n```\n- a\n- b\n\n> quote\n\n| h |\n|---|\n| c |\n';
  const whole = document.createElement('div');
  new MarkdownRenderer(whole).render(doc);
  const streamed = document.createElement('div');
  const md = new MarkdownRenderer(streamed);
  for (const ch of doc) md.append(ch);
  md.flush();
  eq(streamed.innerHTML, whole.innerHTML);
  assert(whole.querySelector('blockquote') && whole.querySelector('table') && whole.querySelector('pre code'), 'blocks missing');
});

// ---------------------------------------------------------------------------
// ws-client against a real WebSocket server
// ---------------------------------------------------------------------------

test('ws-client: connects with token, multiplexes topics, reconnects after a server drop', async () => {
  const url = `${location.origin.replace(/^http/, 'ws')}/ws`;
  const client = createWsClient(url, 's3cret');
  try {
    const opened = next('ws:open');
    const hello = next('server:hello');
    client.connect();
    await opened;
    eq(await hello, { token: 's3cret' }, 'token not delivered:');

    const chat = next('bt:chat');
    assert(client.send({ cmd: 'echo-topic', topic: 'bt:chat', data: { text: 'hi' } }), 'send returned false');
    eq(await chat, { text: 'hi' });

    const closed = next('ws:close');
    const reopened = next('ws:open', 5000);
    client.send({ cmd: 'drop' });
    eq(await closed, { code: 4001, reason: 'dropped by test' });
    await reopened; // automatic reconnect (first delay 0.5-1 s)

    const again = next('bt:chat');
    client.send({ cmd: 'echo-topic', topic: 'bt:chat', data: 'after reconnect' });
    eq(await again, 'after reconnect');
  } finally {
    client.disconnect();
  }
});

test('ws-client: disconnect() stops reconnecting', async () => {
  const url = `${location.origin.replace(/^http/, 'ws')}/ws`;
  const client = createWsClient(url);
  const opened = next('ws:open');
  client.connect();
  await opened;
  client.disconnect();
  let reopened = false;
  const off = subscribe('ws:open', () => { reopened = true; });
  await new Promise((r) => setTimeout(r, 1500)); // longer than the first reconnect delay
  off();
  eq(reopened, false);
  eq(client.send('x'), false);
});

test('README quick-start example works as written', async () => {
  // Copied verbatim from README.md "Quick start".
  const MyGreeting = (() => {
    class MyGreeting extends TelepathicElement {
      static template = `
        <style>
          :host { display: block; }
          .ready { background: yellow; font-size: 3em; }
        </style>
        <h1 class="\${this.status.cssClass}">\${this.status.message}</h1>
        <p>I've been telepathic for \${this.seconds} seconds</p>
        <input value="\${this.name}"> Hello, \${this.name}!
      `;

      init() {                       // runs once, before the first render
        this.status = { message: 'Hello!', cssClass: 'ready' };
        this.seconds = 0;
        this.name = 'world';
      }

      connectedCallback() {          // runs on every connect
        super.connectedCallback();
        const timer = setInterval(() => this.seconds++, 1000);
        this.signal.addEventListener('abort', () => clearInterval(timer)); // cleaned up on disconnect
      }
    }

    customElements.define('my-greeting', MyGreeting);
      return MyGreeting;
  })();
  const el = document.createElement('my-greeting');
  sandbox.append(el);
  await el.ready;
  const h1 = el.$.querySelector('h1');
  eq(h1.textContent, 'Hello!');
  assert(h1.classList.contains('ready'), 'class binding');
  eq(getComputedStyle(h1).backgroundColor, 'rgb(255, 255, 0)');
  const input = el.$.querySelector('input');
  input.value = 'Ada';
  input.dispatchEvent(new Event('input'));
  assert(el.$.textContent.includes('Hello, Ada!'), 'two-way binding');
  const start = el.seconds;
  await waitFor(() => el.seconds > start, el.$, 3000);
  const signal = el.signal;
  el.remove();
  assert(signal.aborted, 'timer cleanup signal');
});

// ---------------------------------------------------------------------------
// Examples
// ---------------------------------------------------------------------------

test('examples/index.html renders: bound component, tokens, streamed markdown, no errors', async () => {
  const frame = document.createElement('iframe');
  const loaded = new Promise((r) => frame.addEventListener('load', r, { once: true }));
  frame.src = '/examples/index.html';
  document.getElementById('frames').append(frame);
  await loaded;
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  const frameErrors = [];
  win.addEventListener('error', (e) => frameErrors.push(e.message));

  const hello = doc.querySelector('hello-world');
  assert(hello instanceof win.HTMLElement && hello.shadowRoot, 'hello-world not upgraded');
  await hello.ready;
  const root = hello.shadowRoot;
  eq(root.querySelector('#title').textContent, 'Hello from telepathic-element v2!');
  assert(!root.textContent.includes('${'), 'unbound ${} placeholder visible');
  eq(win.getComputedStyle(root.querySelector('#title')).getPropertyValue('--color-primary').trim() !== '', true, 'tokens missing');

  // timer binding ticks
  const before = hello.count;
  await waitFor(() => hello.count > before, root, 3000);

  // two-way input and checkbox
  const input = root.querySelector('#name-input');
  input.value = 'Ada';
  input.dispatchEvent(new win.Event('input'));
  eq(root.querySelector('#greeting-line strong').textContent, 'Ada');
  root.querySelector('#loud-box').click();
  assert(root.querySelector('#greeting-line').classList.contains('loud'), 'class binding did not follow the checkbox');

  // streamed markdown
  const out = doc.getElementById('markdown-output');
  await waitFor(() => out.dataset.streamed === 'done', out, 5000);
  for (const sel of ['h2', 'strong', 'em', 'pre code.language-js', 'ul li', 'a[href="https://example.com"]', 'table th', 'blockquote code']) {
    assert(out.querySelector(sel), `markdown output lacks ${sel}`);
  }
  eq(frameErrors, []);
});

// ---------------------------------------------------------------------------

const list = document.getElementById('results');
for (const { name, fn } of tests) {
  const li = list.appendChild(document.createElement('li'));
  li.textContent = name;
  try {
    await fn();
    results.push({ name, ok: true });
    li.className = 'pass';
  } catch (err) {
    results.push({ name, ok: false, error: String(err?.stack ?? err) });
    li.className = 'fail';
    li.textContent += `\n${err?.stack ?? err}`;
  }
}

const failed = results.filter((r) => !r.ok).length;
const summary = document.getElementById('summary');
summary.textContent = `${results.length - failed} pass, ${failed} fail${errors.length ? `, ${errors.length} page errors` : ''}`;
summary.className = failed || errors.length ? 'fail' : 'pass';
window.__results = { userAgent: navigator.userAgent, results, errors };
await fetch('/__results', { method: 'POST', body: JSON.stringify(window.__results) });
