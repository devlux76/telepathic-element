export class TelepathicElement extends HTMLElement {
  static describe() {
    return `TelepathicElement provides the base class for all telepathic-elements. 
            It is responsible for all templating and binding operations.`;
  }

  #templateStr = '';
  #template = null;
  #initialized = false;
  #promises = [];
  #templateBindings = {};
  #templatePropertyNames = {};

  // Read-only public accessor backed by the private field — single source of truth.
  get initialized() { return this.#initialized; }

  constructor(fileName, noshadow = false, delayRender = false) {
    super();

    this.delayRender = delayRender;

    // Shadow DOM with graceful fallback
    if (noshadow) {
      this.$ = this;
    } else {
      try {
        this.$ = this.attachShadow({ mode: 'open' });
      } catch (err) {
        console.debug('Shadow DOM not supported, falling back to light DOM:', err);
        this.$ = this;
      }
    }

    if (fileName) {
      this.templateFileName = fileName;
    }
  }

  // Allow subclasses to register async prerequisites before the first render.
  addInitPromise(p) {
    this.#promises.push(p);
  }

  async connectedCallback() {
    if (this.#initialized) {
      try {
        await this.render();
      } catch (err) {
        console.error(`Error re-rendering ${this.constructor.name}:`, err);
      }
      return;
    }

    this.#initialized = true;
    // Add the component name as a CSS class without clobbering developer-applied classes.
    this.classList.add(this.constructor.name);

    await Promise.all(this.#promises);

    if (this.init) {
      await this.init();
    }

    await this.prepareTemplate();

    if (!this.delayRender) {
      await this.render();
      if (this.onReady) this.onReady();
    }
  }

  disconnectedCallback() {
    this.#unbindAll();
  }

  #unbindAll() {
    for (const binding of Object.values(this.#templateBindings)) {
      binding.unbind();
    }
  }

  async loadFile(fileName) {
    console.debug('Loading:', fileName);
    const response = await fetch(fileName);
    if (!response.ok) {
      throw new Error(`${response.status}: ${response.statusText}`);
    }
    return await response.text();
  }

  // Optional JSON helper (kept for convenience)
  async loadFileJSON(fileName) {
    const response = await fetch(fileName);
    if (!response.ok) throw new Error(`${response.status}: ${response.statusText}`);
    return await response.json();
  }

  async loadTemplate(fileName) {
    if (!fileName && !this.templateFileName) {
      // Auto-resolve using the tag name convention.
      // WARNING: import.meta.url resolves relative to telepathic-element.js, not your
      // component file. This will attempt to load templates from the library directory
      // instead of your component directory. Always pass templateFileName explicitly
      // in your component's constructor to avoid loading from the wrong path.
      const tagName = this.tagName.toLowerCase();
      const path = `/${tagName}/${tagName}.html`; // adjust if you have a base path
      fileName = new URL(path, import.meta.url).href;
    }

    const htmlFile = fileName || this.templateFileName;
    this.#templateStr = await this.loadFile(htmlFile);
    this.templateFileName = htmlFile;
    console.debug('Loaded template:', this.templateFileName);
  }

  async prepareTemplate(fileName) {
    if (!this.#templateStr) {
      await this.loadTemplate(fileName);
    }

    this.#template = document.createElement('template');
    this.#template.innerHTML = this.#templateStr;

    // Clone into shadow/light DOM
    this.$.appendChild(this.#template.content.cloneNode(true));

    // Optional: If you still use telepathic-loader for sub-elements
    if (window.TelepathicLoader?.Load) {
      window.TelepathicLoader.Load(this.$);
    }
  }

  async render() {
    if (!this.#templateStr) return;

    const tags = uniq(this.#templateStr.match(TelepathicElement.templateRegex) || []);
    await this.compileTemplate(tags);
    await this.setIDs();

    console.debug(`${this.templateFileName} rendered`);
  }

  async setIDs() {
    const elements = this.$.querySelectorAll('*');
    elements.forEach((element) => {
      const id = element.id;
      if (id) {
        const varname = id.replaceAll('-', '_');
        this[varname] = element;
        this[varname].owner = this;
        console.debug(`Auto-assigned ${varname} on ${this.localName}`);
      }
    });
  }

  async compileTemplate(tags) {
    // Unbind previous bindings before resetting to prevent duplicate event listeners
    // when render() is called more than once (e.g. on reconnect).
    this.#unbindAll();
    this.#templateBindings = {};
    this.#templatePropertyNames = {};

    for (const tag of tags) {
      let property = tag.replace(/\$\{|}/g, '').replace(/^this\./, '');

      // Handle dotted paths (e.g. this.user.name)
      if (property.includes('.')) {
        const parts = property.split('.');
        let obj = this;
        for (let i = 0; i < parts.length - 1; i++) {
          const p = parts[i];
          if (obj[p] === undefined) obj[p] = {};
          obj = obj[p];
        }
        property = parts[parts.length - 1];
        this.#templateBindings[property] = new DataBind({ object: obj, property });
      } else {
        if (this[property] === undefined) this[property] = undefined;
        this.#templateBindings[property] = new DataBind({ object: this, property });
      }

      this.#templatePropertyNames[tag] = property;
    }

    // Replace ${} placeholders with <span data-bind="...">
    const root = this.$;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let textNode;
    while ((textNode = walker.nextNode())) {
      const txt = textNode.textContent;
      for (const tag of tags) {
        if (txt.includes(tag)) {
          const newNode = document.createElement('span');
          newNode.innerHTML = txt.replaceAll(tag, `<span data-bind="${tag}"></span>`);
          textNode.parentNode.replaceChild(newNode, textNode);
          break; // one replacement per node for safety
        }
      }
    }

    // Compile attributes (two-way where applicable)
    for (const tag of tags) {
      const property = this.#templatePropertyNames[tag];
      for (const node of this.$.querySelectorAll('*')) {
        this.compileNodeAttributes(node, tag, property);
      }
    }
  }

  // Binds a single DOM node attribute to a template tag.
  // NOTE: Only attributes whose value is *exactly* the tag expression (e.g. value="${this.foo}")
  // are bound. Mixed-value attributes like class="btn ${this.state}" are not supported.
  compileNodeAttributes(node, tag, property) {
    if (!node.hasAttributes()) return;

    const attrs = Array.from(node.attributes);
    for (const attr of attrs) {
      if (attr.value !== tag) continue;

      if (attr.name === 'data-bind') {
        node.removeAttribute('data-bind');
        if (this.#templateBindings[property]) {
          this.#templateBindings[property] = this.#templateBindings[property].bindElement(node, 'innerHTML');
        }
      } else {
        // Two-way capable
        const currentValue = this[property];
        if (currentValue == null) {
          if (attr.name !== 'value') node.setAttribute(attr.name, '');
          else node.value = '';
        } else {
          if (attr.name !== 'value') node.setAttribute(attr.name, currentValue);
          else node.value = currentValue;
        }

        if (this.#templateBindings[property]) {
          this.#templateBindings[property] = this.#templateBindings[property].bindElement(
            node,
            attr.name,
            attr.name === 'value' ? 'input' : 'change' // modern: 'input' for live two-way
          );
        }
      }
    }
  }

  // Static regex (unchanged spirit)
  static templateRegex = /\$\{([^}]+)\}/g;
}

// ====================== DataBind (modernized but API-compatible) ======================
export class DataBind {
  #value;
  #elementBindings = [];
  #subscribeFuncs = [];

  constructor(source) {
    this.#value = source.object[source.property];

    Object.defineProperty(source.object, source.property, {
      get: () => this.#value,
      set: (val) => this.#setValue(val),
      configurable: true,
    });

    // Trigger initial set
    source.object[source.property] = this.#value;
  }

  #setValue(val) {
    const oldVal = this.#value;
    this.#value = val;

    for (const binding of this.#elementBindings) {
      try {
        const { element, attribute } = binding;
        if (element[attribute] !== val) {
          if (attribute === 'class') {
            element.classList.remove(oldVal);
            element.classList.add(val);
          } else if (attribute === 'innerHTML') {
            if (val instanceof HTMLElement) {
              element.replaceChildren(val);
            } else {
              element.innerHTML = val ?? '';
            }
          } else if (attribute === 'value') {
            element.value = val ?? '';
          } else {
            element.setAttribute(attribute, val ?? '');
          }
        }
      } catch (e) {
        // silent for readonly cases as before
      }
    }
  }

  bindElement(element, attribute, event = null) {
    const binding = { element, attribute };
    if (event) {
      const handler = () => this.#setValue(element[attribute]);
      element.addEventListener(event, handler);
      binding.event = event;
      binding.handler = handler;
    }
    this.#elementBindings.push(binding);

    // Initial set
    if (this.#value instanceof HTMLElement && attribute === 'innerHTML') {
      element.replaceChildren(this.#value);
    } else {
      element[attribute] = this.#value ?? (attribute === 'value' ? '' : this.#value);
    }

    return this;
  }

  // Remove all event listeners registered by this binding.
  unbind() {
    for (const binding of this.#elementBindings) {
      if (binding.event && binding.handler) {
        binding.element.removeEventListener(binding.event, binding.handler);
      }
    }
    this.#elementBindings = [];
  }
}

// Tiny helpers (modern native)
const uniq = (arr) => [...new Set(arr)];

// sleep is provided as a standalone export so it doesn't pollute every component's public API.
export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
