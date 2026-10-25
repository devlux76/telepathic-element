import { test, expect, describe, beforeEach } from 'bun:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;

import { KeyedList } from './list.js';

// Render function used by the object-item tests.
const render = (item) => {
  const el = document.createElement('li');
  el.textContent = item.text;
  return el;
};

function makeParent() {
  return document.createElement('div');
}

describe('KeyedList', () => {
  test('append adds items', () => {
    const parent = makeParent();
    const list = new KeyedList(parent, (i) => i.id);
    list.append({ id: 'a', text: 'A' });
    list.append({ id: 'b', text: 'B' });
    expect(parent.children.length).toBe(2);
    expect(list.size).toBe(2);
  });

  test('update replaces existing item', () => {
    const parent = makeParent();
    const list = new KeyedList(parent, (i) => i.key, render);
    list.append({ key: 'a', text: 'A' });
    list.update({ key: 'a', text: 'A2' });
    expect(parent.children.length).toBe(1);
    expect(list.get('a').textContent).toBe('A2');
  });

  test('upsert adds if missing', () => {
    const parent = makeParent();
    const list = new KeyedList(parent, (i) => i.key, render);
    list.upsert({ key: 'a', text: 'A' });
    expect(parent.children.length).toBe(1);
  });

  test('upsert replaces if exists', () => {
    const parent = makeParent();
    const list = new KeyedList(parent, (i) => i.key, render);
    list.append({ key: 'a', text: 'A' });
    list.upsert({ key: 'a', text: 'A2' });
    expect(parent.children.length).toBe(1);
    expect(list.get('a').textContent).toBe('A2');
  });

  test('remove deletes by key', () => {
    const parent = makeParent();
    const list = new KeyedList(parent, (i) => i.id);
    list.append({ id: 'a', text: 'A' });
    list.append({ id: 'b', text: 'B' });
    list.remove('a');
    expect(parent.children.length).toBe(1);
    expect(list.has('a')).toBe(false);
    expect(list.has('b')).toBe(true);
  });

  test('clear removes all', () => {
    const parent = makeParent();
    const list = new KeyedList(parent, (i) => i.id);
    list.append({ id: 'a', text: 'A' });
    list.append({ id: 'b', text: 'B' });
    list.clear();
    expect(parent.children.length).toBe(0);
    expect(list.size).toBe(0);
  });

  test('get returns element by key', () => {
    const parent = makeParent();
    const list = new KeyedList(parent, (s) => s);
    list.append('hello');
    expect(list.get('hello')).toBeTruthy();
    expect(list.get('hello').textContent).toBe('hello');
  });
});

describe('KeyedList (audit regressions)', () => {
  test('append with an existing key replaces instead of leaving an orphan', () => {
    const parent = makeParent();
    const list = new KeyedList(parent, (i) => i.id, render);
    list.append({ id: 'a', text: 'A' });
    list.append({ id: 'a', text: 'A again' });
    expect(parent.children.length).toBe(1);
    list.remove('a');
    expect(parent.children.length).toBe(0);
  });

  test('clear() removes only the elements the list manages', () => {
    const parent = makeParent();
    const header = parent.appendChild(document.createElement('h3'));
    const list = new KeyedList(parent, (i) => i.id, render);
    list.append({ id: 'a', text: 'A' });
    list.clear();
    expect([...parent.children]).toEqual([header]);
  });

  test('items are rendered with the render function', () => {
    const parent = makeParent();
    const list = new KeyedList(parent, (i) => i.id, render);
    const el = list.append({ id: 'a', text: 'Hello <b>' });
    expect(el.localName).toBe('li');
    expect(el.textContent).toBe('Hello <b>');
    expect(el.querySelector('b')).toBeNull();
  });

  test('update() keeps the item position', () => {
    const parent = makeParent();
    const list = new KeyedList(parent, (i) => i.id, render);
    list.append({ id: 'a', text: 'A' });
    list.append({ id: 'b', text: 'B' });
    list.update({ id: 'a', text: 'A2' });
    expect([...parent.children].map(e => e.textContent)).toEqual(['A2', 'B']);
  });
});
