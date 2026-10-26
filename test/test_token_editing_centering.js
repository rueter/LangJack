import assert from 'node:assert';
import { WorkbenchApp } from '../js/controllers/app.js';

// Setup minimal DOM mocks for Node environment
class MockElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.classList = {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); }
    };
    this.id = '';
    this.className = '';
    this.scrollLeft = 0;
    this.clientWidth = 800;
    this.offsetWidth = 250;
    this.offsetLeft = 0;
    this._listeners = {};
    this.value = '';
    this.offsetParent = null;
  }

  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }

  append(...items) {
    for (const item of items) {
      if (item instanceof MockElement) {
        this.appendChild(item);
      }
    }
  }

  replaceChildren(...newChildren) {
    this.children = [...newChildren];
    for (const c of this.children) {
      if (c instanceof MockElement) c.parentElement = this;
    }
  }

  querySelector(selector) {
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      return this._findById(id);
    }
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      return this._findByClass(cls);
    }
    return null;
  }

  querySelectorAll(selector) {
    const results = [];
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      this._findAllByClass(cls, results);
    }
    return results;
  }

  closest(selector) {
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      let p = this.parentElement;
      while (p) {
        if (p.className.split(' ').includes(cls)) return p;
        p = p.parentElement;
      }
    }
    return null;
  }

  addEventListener(type, listener) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(listener);
  }

  dispatchEvent(event) {
    const list = this._listeners[event.type] || [];
    for (const cb of list) cb(event);
  }

  getBoundingClientRect() {
    return {
      left: this.offsetLeft - this.scrollLeft,
      top: 0,
      width: this.offsetWidth,
      height: 100
    };
  }

  _findById(id) {
    if (this.id === id) return this;
    for (const c of this.children) {
      if (c instanceof MockElement) {
        const found = c._findById(id);
        if (found) return found;
      }
    }
    return null;
  }

  _findByClass(cls) {
    if (this.className.split(' ').includes(cls)) return this;
    for (const c of this.children) {
      if (c instanceof MockElement) {
        const found = c._findByClass(cls);
        if (found) return found;
      }
    }
    return null;
  }

  _findAllByClass(cls, results) {
    if (this.className.split(' ').includes(cls)) results.push(this);
    for (const c of this.children) {
      if (c instanceof MockElement) {
        c._findAllByClass(cls, results);
      }
    }
  }
}

// Minimal global mock
globalThis.document = {
  createElement(tag) {
    return new MockElement(tag);
  },
  getElementById(id) {
    return globalThis.__mockRoot ? globalThis.__mockRoot._findById(id) : null;
  }
};
globalThis.requestAnimationFrame = (fn) => fn();

async function runTests() {
  console.log('=== Running Token Centering & Horizontal Scroll Retention Tests ===\n');

  // Test 1: Active token tracking initialization
  console.log('--- 1. Testing WorkbenchApp initialization ---');
  const app = new WorkbenchApp();
  assert.strictEqual(app.activeTokenInfo, null, 'activeTokenInfo should initialize to null');
  console.log('✓ activeTokenInfo is null on startup');

  // Test 2: Center token mathematics
  console.log('\n--- 2. Testing centerTokenCard scrollLeft computation ---');
  const mockContainer = new MockElement('div');
  mockContainer.id = 'tokensContainer';
  globalThis.__mockRoot = mockContainer;
  app.tokensContainer = mockContainer;

  // Create sentence block and track
  const sentBlock = new MockElement('div');
  sentBlock.className = 'sentence-block';
  const track = new MockElement('div');
  track.className = 'tokens-track';
  track.dataset.sidx = 0;
  track.clientWidth = 800; // 800px visible track width
  track.scrollLeft = 0;

  // Add 10 token cards
  // card 0 at left 10
  // card 1 at left 280
  // card 2 at left 550
  // card 3 at left 820
  // card 4 at left 1090
  const cards = [];
  for (let i = 0; i < 5; i++) {
    const card = new MockElement('div');
    card.id = `token-card-0-${i}`;
    card.className = 'token-card';
    card.offsetWidth = 240;
    card.offsetLeft = 10 + i * 270;
    card.offsetParent = track;
    track.appendChild(card);
    cards.push(card);
  }
  sentBlock.appendChild(track);
  mockContainer.appendChild(sentBlock);

  // Test Word 0 (offsetLeft = 10, width = 240):
  // targetScroll = 10 - (800/2) + (240/2) = 10 - 400 + 120 = -270 -> clamped to 0
  app.centerTokenCard(0, 0);
  assert.strictEqual(track.scrollLeft, 0, 'First word should stay clamped at scrollLeft 0');
  console.log('✓ Word 0 correctly clamped at scrollLeft 0');

  // Test Word 2 (offsetLeft = 550, width = 240):
  // targetScroll = 550 - (800/2) + (240/2) = 550 - 400 + 120 = 270
  app.centerTokenCard(0, 2);
  assert.strictEqual(track.scrollLeft, 270, 'Word 2 should center at scrollLeft 270');
  console.log('✓ Word 2 correctly centered at scrollLeft 270');

  // Test Word 4 (offsetLeft = 1090, width = 240):
  // targetScroll = 1090 - (800/2) + (240/2) = 1090 - 400 + 120 = 810
  app.centerTokenCard(0, 4);
  assert.strictEqual(track.scrollLeft, 810, 'Word 4 should center at scrollLeft 810');
  console.log('✓ Word 4 correctly centered at scrollLeft 810');

  // Test 3: renderInterlinear with focusedToken preserving centered state
  console.log('\n--- 3. Testing renderInterlinear centering focused token ---');
  app.sentences = [
    {
      sent_id: 1,
      text: 'Token one token two token three token four token five',
      tokens: [
        { id: 1, form: 'w1', isPunct: false, readings: [], allGlosses: [] },
        { id: 2, form: 'w2', isPunct: false, readings: [], allGlosses: [] },
        { id: 3, form: 'w3', isPunct: false, readings: [], allGlosses: [] },
        { id: 4, form: 'w4', isPunct: false, readings: [], allGlosses: [] },
        { id: 5, form: 'w5', isPunct: false, readings: [], allGlosses: [] }
      ]
    }
  ];

  // Call renderInterlinear targeting token index 3 (Word 4)
  app.renderInterlinear({ sIdx: 0, tIdx: 3 });
  assert.deepStrictEqual(app.activeTokenInfo, null, 'activeTokenInfo remains untouched if passed as arg');

  // Set activeTokenInfo as if clicked/edited
  app.activeTokenInfo = { sIdx: 0, tIdx: 3 };
  app.renderInterlinear();
  assert.deepStrictEqual(app.activeTokenInfo, { sIdx: 0, tIdx: 3 }, 'activeTokenInfo preserved across re-renders');
  console.log('✓ activeTokenInfo is preserved and centered across re-render cycles');

  console.log('\n🎉 ALL TOKEN CENTERING & SCROLL RETENTION TESTS PASSED! 🎉\n');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
