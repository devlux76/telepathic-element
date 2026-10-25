// telepathic-element.js — base class for templated web components with ${}
// data binding. Zero dependencies, plain ES module, evergreen browsers only.
//
//   class MyCard extends TelepathicElement {
//     static template = `<h2>${'${this.title}'}</h2><input value="${'${this.title}'}">`;
//   }
//   customElements.define('my-card', MyCard);
//
// Every ${this.path} in the template becomes a live binding: assigning
// this.path updates the DOM, and value/checked bindings on form controls write
// user input back to the property (two-way).

// A binding expression: ${name}, ${this.name} or ${this.a.b.c}. Anything else
// (e.g. ${a + b}) is left in the DOM untouched.
const TAG = /\$\{\s*(?:this\.)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\}/g;
const WHOLE_TAG = new RegExp(`^\\s*${TAG.source}\\s*$`);

const globalSheets = new Set();
const parsedTemplates = new WeakMap(); // component class -> HTMLTemplateElement
const fetchedTemplates = new Map();    // absolute URL -> Promise<string>

export class TelepathicElement extends HTMLElement {
  // ---- Per-class configuration (override with static class fields) --------
  /** Inline template string. Takes precedence over templateUrl. */
  static template = null;
  /** URL of the template file (string or URL). Default: /<tag>/<tag>.html */
  static templateUrl = null;
  /** CSSStyleSheet[] adopted into every instance's shadow root. */
  static styles = [];
  /** false renders into the element itself (light DOM) instead of a shadow root. */
  static shadow = true;
  /** true skips the automatic first render; call this.render() yourself. */
  static delayRender = false;

  /** Adopt a stylesheet into every TelepathicElement constructed from now on. */
  static adoptStyleSheet(sheet) {
    globalSheets.add(sheet);
  }

  /** Render root: the open shadow root, or the element itself in light-DOM mode. */
  $;

  #bindings = new Map(); // binding path ("user.name") -> DataBind
  #ready = Promise.withResolvers(); // settles when initialization finishes
  #started = false;      // initialization running or done
  #stamped = false;
  #connection = null;    // AbortController for the current connection

  constructor() {
    super();
    const { shadow, styles } = this.constructor;
    if (shadow) {
      this.$ = this.attachShadow({ mode: 'open' });
      this.$.adoptedStyleSheets = [...globalSheets, ...styles];
    } else {
      this.$ = this;
    }
  }

  /**
   * Resolves (to the element) once init(), template loading and the first
   * render have completed, whenever that happens (it may be read before the
   * element is connected). Rejects if that initialization fails; the next
   * connect retries, and ready read after the failure waits for the retry.
   */
  get ready() {
    return this.#ready.promise;
  }

  /**
   * AbortSignal for the current connection: aborted when the element is
   * disconnected, renewed when it is connected again. Pass it to
   * addEventListener / subscribe / fetch to get automatic cleanup.
   */
  get signal() {
    return this.#connection?.signal;
  }

  connectedCallback() {
    this.#connection?.abort();
    this.#connection = new AbortController();
    if (!this.#started) {
      this.#started = true;
      this.#initialize().then(this.#ready.resolve, (err) => {
        console.error(`Error initializing <${this.localName}>:`, err);
        const failed = this.#ready;
        this.#ready = Promise.withResolvers(); // for the retry on the next connect
        this.#started = false;
        failed.promise.catch(() => {}); // reported above; avoid unhandledrejection noise
        failed.reject(err);
      });
    }
  }

  disconnectedCallback() {
    // Bindings live entirely inside this component's own DOM, so they are kept
    // (a moved element keeps working). Only per-connection resources end here.
    this.#connection?.abort();
    this.#connection = null;
  }

  async #initialize() {
    const { name, delayRender } = this.constructor;
    if (name) this.classList.add(name);

    if (this.init) await this.init();

    if (!this.#stamped) {
      const template = await templateFor(this.constructor, this.localName);
      this.$.append(template.content.cloneNode(true));
      this.#stamped = true;
    }

    if (!delayRender) {
      this.render();
      if (this.onReady) await this.onReady();
    }
    return this;
  }

  /**
   * Binds every ${} placeholder in the rendered DOM that is not bound yet and
   * maps id="some-id" elements to this.some_id. Idempotent: calling it again
   * (e.g. after appending more DOM) keeps existing bindings.
   */
  render() {
    const textNodes = [];
    const elements = [];
    const visit = (parent) => {
      const raw = parent.localName === 'script' || parent.localName === 'style';
      for (const child of parent.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          if (!raw && child.data.includes('${')) textNodes.push(child);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          elements.push(child);
          // A nested light-DOM TelepathicElement owns (and binds) its own content.
          if (!(child instanceof TelepathicElement && child.$ === child)) visit(child);
        }
      }
    };
    visit(this.$);

    for (const textNode of textNodes) this.#bindText(textNode);
    for (const element of elements) this.#bindAttributes(element);
    this.#assignIds(elements);
  }

  #binding(path) {
    let binding = this.#bindings.get(path);
    if (binding) return binding;
    const parts = path.split('.');
    let object = this;
    for (const part of parts.slice(0, -1)) {
      if (object[part] == null) object[part] = {};
      object = object[part];
    }
    try {
      binding = new DataBind({ object, property: parts.at(-1) });
    } catch (err) {
      console.warn(`<${this.localName}>: cannot bind \${${path}}:`, err);
      return null;
    }
    this.#bindings.set(path, binding);
    return binding;
  }

  // Replace every ${} in a text node with a <span> bound via textContent.
  #bindText(textNode) {
    const text = textNode.data;
    const fragment = document.createDocumentFragment();
    let last = 0;
    for (const match of text.matchAll(TAG)) {
      const binding = this.#binding(match[1]);
      if (!binding) continue;
      if (match.index > last) fragment.append(text.slice(last, match.index));
      const span = document.createElement('span');
      fragment.append(span);
      binding.bindElement(span, 'textContent');
      last = match.index + match[0].length;
    }
    if (last === 0) return;
    if (last < text.length) fragment.append(text.slice(last));
    textNode.replaceWith(fragment);
  }

  // Bind attributes whose whole value is one ${} expression. Mixed values such
  // as class="btn ${this.state}" are not bound and are left as written.
  #bindAttributes(element) {
    for (const { name, value } of [...element.attributes]) {
      const match = WHOLE_TAG.exec(value);
      if (!match) continue;
      const binding = this.#binding(match[1]);
      if (!binding) continue;
      element.removeAttribute(name);
      if (name === 'data-bind') {
        binding.bindElement(element, 'textContent');
      } else if (name === 'data-bind-html') {
        // Explicit opt-in: the value is inserted as HTML. Trusted content only.
        binding.bindElement(element, 'innerHTML');
      } else if (name === 'value') {
        binding.bindElement(element, 'value', 'input');
      } else {
        // Properties the user can change (checked, selected, ...) write back.
        binding.bindElement(element, name, name in element ? 'change' : null);
      }
    }
  }

  #assignIds(elements) {
    for (const element of elements) {
      if (!element.id || element === this) continue;
      const name = element.id.replaceAll('-', '_');
      if (this.#bindings.has(name) || (typeof this[name] === 'function')) {
        console.warn(`<${this.localName}>: id "${element.id}" would overwrite this.${name}; skipped`);
        continue;
      }
      this[name] = element;
      element.owner = this;
    }
  }
}

async function templateFor(Component, tagName) {
  let template = parsedTemplates.get(Component);
  if (template) return template;

  let source = Component.template;
  if (source == null) {
    const url = new URL(Component.templateUrl ?? `/${tagName}/${tagName}.html`, document.baseURI).href;
    let request = fetchedTemplates.get(url);
    if (!request) {
      request = fetch(url).then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
        return response.text();
      });
      fetchedTemplates.set(url, request);
      request.catch(() => fetchedTemplates.delete(url)); // let a later attempt retry
    }
    source = await request;
  }

  template = parsedTemplates.get(Component);
  if (!template) {
    template = document.createElement('template');
    template.innerHTML = source;
    parsedTemplates.set(Component, template);
  }
  return template;
}

// ====================== DataBind ======================
// Turns object[property] into an accessor that pushes every assignment to the
// bound DOM nodes. A getter/setter the class already defines keeps working.
export class DataBind {
  #value;
  #get = null;
  #set = null;
  #targets = [];
  #listeners = new AbortController();

  constructor({ object, property }) {
    const accessor = findAccessor(object, property);
    if (accessor) {
      this.#get = accessor.get?.bind(object) ?? null;
      this.#set = accessor.set?.bind(object) ?? null;
    } else {
      this.#value = object[property];
    }
    Object.defineProperty(object, property, {
      get: () => this.value,
      set: (value) => this.#setValue(value),
      configurable: true,
      enumerable: true,
    });
  }

  get value() {
    return this.#get ? this.#get() : this.#value;
  }

  #setValue(value) {
    const old = this.value;
    if (this.#set) this.#set(value);
    else if (!this.#get) this.#value = value;
    const current = this.value;
    for (const { element, attribute } of this.#targets) {
      try {
        apply(element, attribute, current, old);
      } catch (err) {
        console.warn(`DataBind: could not set ${attribute}`, err);
      }
    }
  }

  /**
   * Bind element[attribute] to this value. With an event name, the element's
   * property is written back on that event (two-way). Returns this.
   */
  bindElement(element, attribute, event = null) {
    this.#targets.push({ element, attribute });
    if (event) {
      element.addEventListener(event, () => this.#setValue(element[attribute]), {
        signal: this.#listeners.signal,
      });
    }
    apply(element, attribute, this.value, undefined);
    return this;
  }

  /** Detach from all elements and remove the two-way event listeners. */
  unbind() {
    this.#listeners.abort();
    this.#listeners = new AbortController();
    this.#targets = [];
  }
}

function findAccessor(object, property) {
  for (let o = object; o && o !== HTMLElement.prototype && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    const descriptor = Object.getOwnPropertyDescriptor(o, property);
    if (descriptor) return descriptor.get || descriptor.set ? descriptor : null;
  }
  return null;
}

const classTokens = (value) => (value == null || value === false ? [] : String(value).split(/\s+/).filter(Boolean));

function apply(element, attribute, value, old) {
  switch (attribute) {
    case 'textContent':
    case 'innerHTML':
      if (value instanceof Node) element.replaceChildren(value);
      else element[attribute] = value ?? '';
      return;
    case 'class':
      element.classList.remove(...classTokens(old));
      element.classList.add(...classTokens(value));
      return;
    case 'value': {
      const text = String(value ?? '');
      if (element.value !== text) element.value = text; // keeps the caret while typing
      return;
    }
  }
  if (typeof value === 'boolean' && !attribute.startsWith('aria-')) {
    // Boolean values mean presence/absence (or the matching IDL property,
    // e.g. checked, which the attribute alone cannot change once dirty).
    if (typeof element[attribute] === 'boolean') element[attribute] = value;
    else element.toggleAttribute(attribute, value);
    return;
  }
  element.setAttribute(attribute, value ?? '');
}
