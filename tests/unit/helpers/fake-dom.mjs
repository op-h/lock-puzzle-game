// A very small DOM: just enough surface (createElement/NS, attributes, children, dataset, style.setProperty, class
// selectors in querySelector) to test the pure-ish builders without a browser. Not a general jsdom replacement.

class FakeEl {
  constructor(tag, ownerDocument) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.attrs = new Map();
    this.children = [];
    this.dataset = {};
    this.style = { props: new Map(), setProperty: (k, v) => this.style.props.set(k, v) };
    this._text = '';
  }
  setAttribute(k, v) {
    this.attrs.set(k, String(v));
  }
  getAttribute(k) {
    return this.attrs.has(k) ? this.attrs.get(k) : null;
  }
  set className(v) {
    this.attrs.set('class', v);
  }
  get className() {
    return this.attrs.get('class') || '';
  }
  set textContent(v) {
    this._text = String(v);
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  append(...kids) {
    for (const k of kids) {
      if (typeof k === 'string') this._text += k;
      else this.children.push(k);
    }
  }
  replaceChildren(...kids) {
    this.children = [];
    this._text = '';
    this.append(...kids);
  }
  hasClass(c) {
    return this.className.split(/\s+/).includes(c);
  }
  querySelector(sel) {
    const cls = sel.startsWith('.') ? sel.slice(1) : null;
    for (const c of this.children) {
      if (cls && c.hasClass(cls)) return c;
      const deep = c.querySelector(sel);
      if (deep) return deep;
    }
    return null;
  }
}

export function createFakeDocument() {
  const doc = {
    createElement: (tag) => new FakeEl(tag, doc),
    createElementNS: (_ns, tag) => new FakeEl(tag, doc),
  };
  return doc;
}
