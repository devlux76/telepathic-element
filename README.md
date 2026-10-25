# telepathic-element

![i think therefore i can][1]

Telepathic Elements are templated web components with data binding, designed to be so easy to use it's just like telepathy.

Write HTML with `${this.something}` in it, extend `TelepathicElement`, and every placeholder is live: assign `this.something` and the page updates; type into a bound `<input>` and the property updates.

Plain ES modules, zero runtime dependencies, evergreen browsers only (custom elements, shadow DOM, constructable stylesheets). Bun is used for tests and the build only.

## Quick start

```js
// my-greeting.js
import { TelepathicElement } from './telepathic-element.js';

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
```

```html
<script type="module" src="my-greeting.js"></script>
<my-greeting></my-greeting>
```

Serve it from any static host and it just works. (Inside a JS template literal the placeholders are written `\${...}`; in a separate `.html` template file they are written plainly, `${this.seconds}`.)

## Templates

Pick one per component, as static class fields:

| Field | Meaning |
|-------|---------|
| `static template = '...'` | Inline template string. |
| `static templateUrl = new URL('./my-greeting.html', import.meta.url)` | Template file, fetched once per class and cached. |
| *(neither)* | Fetches `/<tag-name>/<tag-name>.html` from the origin root. |

Other static options:

| Field | Default | Meaning |
|-------|---------|---------|
| `static styles` | `[]` | `CSSStyleSheet`s adopted into each instance's shadow root. |
| `static shadow` | `true` | `false` renders into the element itself (light DOM). |
| `static delayRender` | `false` | `true` skips the automatic first render; call `this.render()` yourself. |

`TelepathicElement.adoptStyleSheet(sheet)` adopts a sheet into every component constructed afterwards (e.g. your design tokens).

## Binding

- **Text:** `${this.message}` (or `${message}`) anywhere in text. Rendered with `textContent`, so values are never parsed as HTML. A DOM node as the value is inserted as-is.
- **Nested paths:** `${this.user.name}` binds `this.user.name`; missing intermediate objects are created.
- **Attributes:** an attribute whose whole value is a placeholder, e.g. `title="${this.tip}"` or `class="${this.state}"`. Mixed values such as `class="btn ${this.state}"` are not bound and stay as written. Boolean values toggle boolean attributes/properties: `disabled="${this.busy}"`, `checked="${this.done}"`.
- **Two-way:** `value="${this.name}"` updates `this.name` on every `input` event; properties the user can change (e.g. `checked`) update on `change`.
- **Trusted HTML:** `<div data-bind-html="${this.html}"></div>` sets `innerHTML`. Only for content you trust.
- Expressions that are not property paths (`${a + b}`) are left as text.
- Getters/setters your class defines for a bound property keep working.
- Avoid binding names of built-in element properties (`title`, `style`, `id`, `hidden`, …) on `this`; use your own names.

## Lifecycle

| Member | When |
|--------|------|
| `init()` | Once, on first connect, before the template is stamped. Set initial values here. May be async. |
| `onReady()` | Once, after the first render. The DOM is available. |
| `this.ready` | Promise that resolves after `init`, template loading and the first render (rejects if they failed; a later reconnect retries). |
| `this.signal` | `AbortSignal` that aborts when the element is disconnected; renewed on each connect. Pass it to `addEventListener`, `fetch`, `subscribe`. |
| `this.$` | The render root: the shadow root, or the element itself when `static shadow = false`. |
| `this.some_id` | Every element with `id="some-id"` in the template (dashes become underscores). Each gets `.owner` pointing at the component. |
| `render()` | Binds placeholders not bound yet. Idempotent; called for you unless `delayRender`. |

Bindings survive disconnect/reconnect: moving an element around the page keeps it live.

## Modules

| Module | Purpose |
|--------|---------|
| `telepathic-element.js` | `TelepathicElement` base class and `DataBind`. |
| `channels.js` | Named pub/sub: `subscribe(topic, fn, { signal })` returns an unsubscribe function; `publish(topic, data)`. |
| `list.js` | `new KeyedList(parent, keyFn, renderFn)`: keyed `append` / `update` / `upsert` / `remove` / `clear` for feeds. |
| `markdown.js` | `new MarkdownRenderer(container)`: XSS-safe streaming markdown (`append(chunk)`, `flush()`, `render(text)`). Builds DOM nodes directly, never parses HTML; links only for `http(s)` URLs. Headings, paragraphs, bold/italic, inline code, fenced code, lists, blockquotes, tables. |
| `ws-client.js` | `createWsClient(url, token)`: `connect()`, `disconnect()`, `send(data)` (returns `false` when not open), `subscribe(topic, fn)`. Reconnects with exponential backoff and jitter (1 s doubling to 30 s), sends a `{"type":"ping"}` keepalive every 30 s, appends `token` as a query parameter, and publishes inbound `{topic, data}` frames on that channel, plus `ws:open`, `ws:close`, `ws:error`, `ws:message`. `ws:close` reports dropped connections (not your own `disconnect()`). All clients share one channel bus. The module also exports a default client's `connect`/`disconnect`/`send`/`subscribe`. |
| `tokens.css` / `tokens.js` | Design tokens (colors with light/dark, spacing, type scale, radii, shadows). `tokens.js` exports `tokenSheet` (a constructable stylesheet), `cssText`, and `applyTokens(root = document)` for a shadow root or the document. |

```js
import { tokenSheet } from './tokens.js';
class MyCard extends TelepathicElement {
  static styles = [tokenSheet];          // or: TelepathicElement.adoptStyleSheet(tokenSheet) for all components
  static template = `<p style="padding: var(--space-4)">...</p>`;
}
```

## Size

Minified + gzipped (`bun run build`): telepathic-element 2.1 KB, markdown 1.3 KB, tokens 0.9 KB, ws-client 0.7 KB, list 0.4 KB, channels 0.3 KB.

## Testing

```sh
bun test               # unit tests (jsdom / happy-dom)
bun run test:browser   # real browser: headless Chrome runs test/browser/index.html
bun run serve          # serve the repo at http://localhost:8037 (tests: /test/browser/, demo: /examples/)
```

`test:browser` uses `/usr/bin/google-chrome` (set `CHROME_BIN` for another Chrome/Chromium). It covers custom element upgrade, shadow DOM, adoptedStyleSheets and computed token values, real input/click events, markdown XSS in a live document, `ws-client` against a real WebSocket server (including a server drop and reconnect), and the example page.

## Building

```sh
bun run build          # -> dist/  (bun run build.js <dir> for another directory)
```

Outputs one minified ES module per module plus `tokens.css`. Modules import each other by relative path, so `dist/ws-client.js` and `dist/channels.js` share one channel bus.

## Migrating from v1 (2018–2026)

v2 is a clean break; it keeps the idea (templates with `${}` binding, zero dependencies) and uses current platform features.

| v1 | v2 |
|----|----|
| `super(fileName, noshadow, delayRender)` | `static templateUrl`, `static shadow = false`, `static delayRender = true` |
| `super.connectedCallback('file.html')`, `this.templateStr = '...'`, `setTemplate()` | `static template` / `static templateUrl` |
| Template path from `window[ClassName]` (TelepathicLoader) | `static templateUrl` (resolve with `import.meta.url`) |
| `this.promises.push(p)` | `async init() { await p; }` |
| `${}` text rendered as HTML (`innerHTML`) | rendered as text; use `data-bind-html` for trusted HTML |
| `this.sleep(ms)`, `loadFileJSON()`, `describe()`, `this.initialized` | removed; use `await new Promise(r => setTimeout(r, ms))`, `fetch`, `this.ready` |
| Re-render on every reconnect | bindings persist; `this.signal` for per-connection cleanup |
| `prepareTemplate()` before `init()` | `init()` runs before the template is stamped; use `onReady()` for DOM work |
| `loadTemplate`, `prepareTemplate`, `compileTemplate`, `setIDs` overridable | internal (`#private`); override `init`, `onReady`, `connectedCallback` |
| `KeyedList(parent, keyFn)` rendered objects as `[object Object]` | `KeyedList(parent, keyFn, renderFn)` |

[1]:http://www.pradeepaggarwal.com/ud_160/img_udemy.jpg
