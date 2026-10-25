import { TelepathicElement } from '../telepathic-element.js';
import { tokenSheet } from '../tokens.js';

class HelloWorld extends TelepathicElement {
  // The template lives next to this file; it is fetched once per class.
  static templateUrl = new URL('./hello-world.html', import.meta.url);
  // Constructable stylesheets adopted into each instance's shadow root.
  static styles = [tokenSheet];

  init() {
    this.greeting = 'Hello from telepathic-element v2!';
    this.name = 'world';
    this.loud = false;
    this.tone = '';
    this.count = 0;
  }

  onReady() {
    // Elements with an id are available as this.<id with - replaced by _>.
    this.loud_box.addEventListener('change', () => { this.tone = this.loud ? 'loud' : ''; });
  }

  connectedCallback() {
    super.connectedCallback();
    // Per-connection work: this.signal aborts when the element is removed.
    const timer = setInterval(() => { this.count++; }, 1000);
    this.signal.addEventListener('abort', () => clearInterval(timer));
  }
}

customElements.define('hello-world', HelloWorld);
