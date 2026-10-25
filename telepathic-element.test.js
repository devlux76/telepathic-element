import { test, expect, describe } from 'bun:test';

// Set up DOM globals before importing
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true });
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Event = dom.window.Event;
globalThis.customElements = dom.window.customElements;
globalThis.ShadowRoot = dom.window.ShadowRoot;
globalThis.NodeFilter = dom.window.NodeFilter;
globalThis.Node = dom.window.Node;
globalThis.AbortController = dom.window.AbortController; // jsdom rejects foreign-realm signals
globalThis.fetch = async () => ({ ok: false, status: 404, statusText: 'Not Found' });

const { DataBind, TelepathicElement } = await import('./telepathic-element.js');

describe('DataBind v2 (safe-by-default)', () => {
  test('textContent binding: value updates element text', () => {
    const obj = { msg: '' };
    const span = document.createElement('span');
    const binding = new DataBind({ object: obj, property: 'msg' });
    binding.bindElement(span, 'textContent');
    obj.msg = 'hello';
    expect(span.textContent).toBe('hello');
  });

  test('textContent binding: HTMLElement uses replaceChildren', () => {
    const obj = { node: null };
    const span = document.createElement('span');
    const binding = new DataBind({ object: obj, property: 'node' });
    binding.bindElement(span, 'textContent');
    const child = document.createElement('em');
    child.textContent = 'emphasis';
    obj.node = child;
    expect(span.firstChild).toBe(child);
    expect(span.textContent).toBe('emphasis');
  });

  test('innerHTML binding: explicit opt-in', () => {
    const obj = { html: '' };
    const span = document.createElement('span');
    const binding = new DataBind({ object: obj, property: 'html' });
    binding.bindElement(span, 'innerHTML');
    obj.html = '<b>bold</b>';
    expect(span.innerHTML).toBe('<b>bold</b>');
    expect(span.querySelector('b')).toBeTruthy();
  });

  test('innerHTML binding: HTMLElement uses replaceChildren', () => {
    const obj = { node: null };
    const span = document.createElement('span');
    const binding = new DataBind({ object: obj, property: 'node' });
    binding.bindElement(span, 'innerHTML');
    const child = document.createElement('em');
    child.textContent = 'emphasis';
    obj.node = child;
    expect(span.firstChild).toBe(child);
  });

  test('class binding handles multi-class strings', () => {
    const obj = { cls: '' };
    const div = document.createElement('div');
    const binding = new DataBind({ object: obj, property: 'cls' });
    binding.bindElement(div, 'class');
    obj.cls = 'a b';
    expect(div.classList.contains('a')).toBe(true);
    expect(div.classList.contains('b')).toBe(true);
    obj.cls = 'c';
    expect(div.classList.contains('a')).toBe(false);
    expect(div.classList.contains('b')).toBe(false);
    expect(div.classList.contains('c')).toBe(true);
  });

  test('value binding: two-way input', () => {
    const obj = { val: 'initial' };
    const input = document.createElement('input');
    const binding = new DataBind({ object: obj, property: 'val' });
    binding.bindElement(input, 'value', 'input');
    expect(input.value).toBe('initial');
    input.value = 'changed';
    input.dispatchEvent(new Event('input'));
    expect(obj.val).toBe('changed');
  });

  test('attribute binding: sets attribute on element', () => {
    const obj = { title: 'tooltip' };
    const div = document.createElement('div');
    const binding = new DataBind({ object: obj, property: 'title' });
    binding.bindElement(div, 'title');
    expect(div.getAttribute('title')).toBe('tooltip');
    obj.title = 'new tooltip';
    expect(div.getAttribute('title')).toBe('new tooltip');
  });

  test('unbind removes event listeners', () => {
    const obj = { val: '' };
    const input = document.createElement('input');
    const binding = new DataBind({ object: obj, property: 'val' });
    binding.bindElement(input, 'value', 'input');
    binding.unbind();
    input.value = 'changed';
    input.dispatchEvent(new Event('input'));
    expect(obj.val).toBe(''); // should not update after unbind
  });
});

// ---------------------------------------------------------------------------
// Quality-audit regression tests (2026-10). Each of these failed on 2f9fbbe.
// ---------------------------------------------------------------------------

const settle = () => new Promise(r => setTimeout(r, 5));
let tagSeq = 0;

// Define a component with an inline template, mount it and wait for the first
// render to complete.
async function mount(template, { setup, extend } = {}) {
  const Base = class extends TelepathicElement {
    static template = template;
  };
  const Cls = extend ? extend(Base) : Base;
  const tag = `audit-el-${++tagSeq}`;
  customElements.define(tag, Cls);
  const el = document.createElement(tag);
  if (setup) setup(el);
  document.body.appendChild(el);
  await el.ready;
  return el;
}

describe('TelepathicElement bindings survive reconnect', () => {
  test('text and two-way value bindings keep working after the element is moved', async () => {
    const el = await mount('<p id="out">${this.msg}</p><input id="inp" value="${this.msg}">');
    el.msg = 'one';
    expect(el.out.textContent).toBe('one');

    // Move the element: disconnect + reconnect (e.g. re-ordering a list).
    const other = document.createElement('section');
    document.body.appendChild(other);
    other.appendChild(el);
    await settle();

    el.msg = 'two';
    expect(el.$.querySelector('#out').textContent).toBe('two');
    expect(el.$.querySelector('#inp').value).toBe('two');

    const inp = el.$.querySelector('#inp');
    inp.value = 'typed';
    inp.dispatchEvent(new Event('input'));
    expect(el.msg).toBe('typed');
    expect(el.$.querySelector('#out').textContent).toBe('typed');
    other.remove();
  });

  test('calling render() again does not drop bindings', async () => {
    const el = await mount('<p id="out">${this.msg}</p>');
    await el.render();
    el.msg = 'after second render';
    expect(el.out.textContent).toBe('after second render');
    el.remove();
  });
});

describe('TelepathicElement dotted paths', () => {
  test('two paths with the same leaf name bind independently', async () => {
    const el = await mount('<p id="a">${this.user.name}</p><p id="b">${this.pet.name}</p>');
    el.user.name = 'Ada';
    el.pet.name = 'Rex';
    expect(el.a.textContent).toBe('Ada');
    expect(el.b.textContent).toBe('Rex');
    el.remove();
  });

  test('a dotted path and a top-level property with the same leaf name do not collide', async () => {
    const el = await mount('<p id="a">${this.name}</p><p id="b">${this.user.name}</p>');
    el.name = 'top';
    el.user.name = 'nested';
    expect(el.a.textContent).toBe('top');
    expect(el.b.textContent).toBe('nested');
    el.remove();
  });

  test('dotted attribute binding gets the nested value, not this[leaf]', async () => {
    const el = await mount('<a id="link" title="${this.user.label}">x</a>', {
      setup: (e) => { e.user = { label: 'hello' }; },
    });
    expect(el.link.getAttribute('title')).toBe('hello');
    el.remove();
  });

  test('${foo} and ${this.foo} share one binding', async () => {
    const el = await mount('<p id="a">${foo}</p><p id="b">${this.foo}</p>');
    el.foo = 'same';
    expect(el.a.textContent).toBe('same');
    expect(el.b.textContent).toBe('same');
    el.remove();
  });
});

describe('TelepathicElement attribute bindings', () => {
  test('generic attribute set X -> Y -> X ends at X', async () => {
    const el = await mount('<div id="d" data-state="${this.state}" aria-label="${this.label}"></div>', {
      setup: (e) => { e.state = 'x'; e.label = 'x'; },
    });
    el.state = 'y'; el.state = 'x';
    el.label = 'y'; el.label = 'x';
    expect(el.d.getAttribute('data-state')).toBe('x');
    expect(el.d.getAttribute('aria-label')).toBe('x');
    el.remove();
  });

  test('class binding set X -> Y -> X ends at X', async () => {
    const el = await mount('<div id="d" class="${this.cls}"></div>', {
      setup: (e) => { e.cls = 'x'; },
    });
    el.cls = 'y';
    el.cls = 'x';
    expect(el.d.classList.contains('x')).toBe(true);
    expect(el.d.classList.contains('y')).toBe(false);
    el.remove();
  });

  test('boolean properties (checked) follow true/false values', async () => {
    const el = await mount('<input id="c" type="checkbox" checked="${this.done}">', {
      setup: (e) => { e.done = false; },
    });
    expect(el.c.checked).toBe(false);
    el.done = true;
    expect(el.c.checked).toBe(true);
    el.done = false;
    expect(el.c.checked).toBe(false);
    // two-way: user clicks the box
    el.c.checked = true;
    el.c.dispatchEvent(new Event('change'));
    expect(el.done).toBe(true);
    el.remove();
  });
});

describe('TelepathicElement edge cases', () => {
  test('an anonymous subclass initializes (empty constructor.name)', async () => {
    const tag = `audit-anon-${++tagSeq}`;
    customElements.define(tag, class extends TelepathicElement {
      static template = '<p id="p">${this.v}</p>';
    });
    const el = document.createElement(tag);
    const origError = console.error; const errors = [];
    console.error = (...a) => errors.push(a);
    try {
      document.body.appendChild(el);
      await el.ready;
    } finally { console.error = origError; }
    expect(errors).toEqual([]);
    el.v = 'ok';
    expect(el.$.querySelector('#p').textContent).toBe('ok');
    el.remove();
  });

  test('a property with a class setter keeps its setter behaviour', async () => {
    const el = await mount('<p id="p">${this.count}</p>', {
      extend: (Base) => class extends Base {
        #count = 0;
        seen = [];
        get count() { return this.#count; }
        set count(v) { this.#count = Number(v); this.seen.push(v); }
      },
    });
    el.count = '5';
    expect(el.seen).toContain('5');
    expect(el.count).toBe(5);
    expect(el.p.textContent).toBe('5');
    el.remove();
  });
});

describe('TelepathicElement templates', () => {
  test('templateUrl is fetched once per class, not once per instance', async () => {
    const urls = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (u) => { urls.push(String(u)); return { ok: true, text: async () => '<p id="p">${this.msg}</p>' }; };
    try {
      const tag = `audit-url-${++tagSeq}`;
      customElements.define(tag, class extends TelepathicElement {
        static templateUrl = 'http://localhost/tpl/card.html';
      });
      const els = [1, 2, 3].map(() => document.body.appendChild(document.createElement(tag)));
      await Promise.all(els.map(e => e.ready));
      expect(urls).toEqual(['http://localhost/tpl/card.html']);
      els[1].msg = 'second';
      expect(els[1].p.textContent).toBe('second');
      expect(els[0].p.textContent).toBe('');
      els.forEach(e => e.remove());
    } finally { globalThis.fetch = origFetch; }
  });

  test('a failed template load rejects ready and is retried on reconnect', async () => {
    let calls = 0;
    const origFetch = globalThis.fetch;
    const origError = console.error;
    console.error = () => {};
    globalThis.fetch = async () => (++calls === 1
      ? { ok: false, status: 503, statusText: 'Unavailable' }
      : { ok: true, text: async () => '<p id="p">${this.msg}</p>' });
    try {
      const tag = `audit-retry-${++tagSeq}`;
      customElements.define(tag, class extends TelepathicElement {
        static templateUrl = 'http://localhost/tpl/retry.html';
      });
      const el = document.body.appendChild(document.createElement(tag));
      await expect(el.ready).rejects.toThrow('503');
      el.remove();
      document.body.appendChild(el);
      await el.ready;
      el.msg = 'recovered';
      expect(el.p.textContent).toBe('recovered');
      expect(el.$.querySelectorAll('#p').length).toBe(1);
      el.remove();
    } finally { globalThis.fetch = origFetch; console.error = origError; }
  });

  test('expressions that are not property paths are left as written', async () => {
    const el = await mount('<p id="p">${a + b} and ${this.x}</p>');
    el.x = 'X';
    expect(el.p.textContent).toBe('${a + b} and X');
    expect('a + b' in el).toBe(false);
    el.remove();
  });

  test('an id that matches a bound property does not overwrite the property', async () => {
    const origWarn = console.warn; console.warn = () => {};
    try {
      const el = await mount('<p id="msg">${this.msg}</p>');
      el.msg = 'text';
      expect(el.msg).toBe('text');
      expect(el.$.querySelector('#msg').textContent).toBe('text');
      el.remove();
    } finally { console.warn = origWarn; }
  });

  test('ready obtained before connecting resolves only after the first render', async () => {
    const tag = `audit-early-${++tagSeq}`;
    customElements.define(tag, class extends TelepathicElement {
      static template = '<p id="p">${this.msg}</p>';
    });
    const el = document.createElement(tag);
    const ready = el.ready;
    let settled = false;
    ready.then(() => { settled = true; });
    await settle();
    expect(settled).toBe(false);
    document.body.appendChild(el);
    expect(await ready).toBe(el);
    expect(el.p).toBeTruthy();
    el.remove();
  });

  test('after a failed init, ready waits for the retry instead of resolving', async () => {
    let calls = 0;
    const origFetch = globalThis.fetch;
    const origError = console.error;
    console.error = () => {};
    globalThis.fetch = async () => (++calls === 1
      ? { ok: false, status: 500, statusText: 'Boom' }
      : { ok: true, text: async () => '<p id="p">ok</p>' });
    try {
      const tag = `audit-retry2-${++tagSeq}`;
      customElements.define(tag, class extends TelepathicElement {
        static templateUrl = 'http://localhost/tpl/retry2.html';
      });
      const el = document.body.appendChild(document.createElement(tag));
      await el.ready.catch(() => {});
      let settled = false;
      const later = el.ready.then(() => { settled = true; }, () => { settled = true; });
      await settle();
      expect(settled).toBe(false);
      el.remove();
      document.body.appendChild(el);
      await later;
      expect(el.p.textContent).toBe('ok');
      el.remove();
    } finally { globalThis.fetch = origFetch; console.error = origError; }
  });

  test('signal aborts on disconnect and is renewed on reconnect', async () => {
    const el = await mount('<p></p>');
    const first = el.signal;
    expect(first.aborted).toBe(false);
    el.remove();
    expect(first.aborted).toBe(true);
    document.body.appendChild(el);
    expect(el.signal.aborted).toBe(false);
    expect(el.signal).not.toBe(first);
    el.remove();
  });
});
