// list.js — Keyed list helper for feeds. Keyed append/update/remove/clear.
// No virtual DOM. Zero dependencies.
//
//   const list = new KeyedList(ul, (msg) => msg.id, (msg) => {
//     const li = document.createElement('li');
//     li.textContent = msg.text;
//     return li;
//   });
//   list.upsert({ id: 1, text: 'hello' });

const defaultRender = (item) => {
  const el = document.createElement('div');
  el.textContent = String(item);
  return el;
};

export class KeyedList {
  #parent;
  #keyFn;
  #render;
  #map = new Map(); // key -> element

  /**
   * @param parent  element the items are rendered into
   * @param keyFn   item -> unique key
   * @param render  item -> Element (default: a <div> with String(item) as text).
   *                Items that already are Elements are inserted as they are.
   */
  constructor(parent, keyFn, render = defaultRender) {
    this.#parent = parent;
    this.#keyFn = keyFn;
    this.#render = render;
  }

  #element(item) {
    return item instanceof Element ? item : this.#render(item);
  }

  /** Add an item at the end; an item whose key exists is replaced in place. */
  append(item) {
    return this.upsert(item);
  }

  /** Replace the item with the same key in place (appends if missing). */
  update(item) {
    return this.upsert(item);
  }

  upsert(item) {
    const key = this.#keyFn(item);
    const existing = this.#map.get(key);
    const el = this.#element(item);
    if (existing?.parentNode === this.#parent) existing.replaceWith(el);
    else this.#parent.append(el);
    this.#map.set(key, el);
    return el;
  }

  remove(key) {
    this.#map.get(key)?.remove();
    this.#map.delete(key);
  }

  /** Remove every item this list added; other children of parent stay. */
  clear() {
    for (const el of this.#map.values()) el.remove();
    this.#map.clear();
  }

  has(key) {
    return this.#map.has(key);
  }

  get(key) {
    return this.#map.get(key);
  }

  get size() {
    return this.#map.size;
  }
}
