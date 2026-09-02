/* eslint-env browser, es2021 */
// Page init script for standby-boot-probe.ts --shim: wraps hot DOM entry
// points with call counters and wall-time accumulators so a boot can be
// attributed. Read the totals with --after "__domProfileTop(20)".
if (typeof document.queryCommandSupported !== 'function') {
  document.queryCommandSupported = () => false;
}
(() => {
  let prof = (globalThis.__domProfile = {});
  let now = () => performance.now();
  let wrapMethod = (obj, name, label) => {
    let d = Object.getOwnPropertyDescriptor(obj, name);
    if (!d || typeof d.value !== 'function') return;
    let orig = d.value;
    let key = label || name;
    prof[key] = { calls: 0, ms: 0 };
    Object.defineProperty(obj, name, {
      ...d,
      value: function (...args) {
        let t = now();
        try {
          return orig.apply(this, args);
        } finally {
          let e = prof[key];
          e.calls++;
          e.ms += now() - t;
        }
      },
    });
  };
  let wrapGetter = (obj, name, label) => {
    let d = Object.getOwnPropertyDescriptor(obj, name);
    if (!d || typeof d.get !== 'function') return;
    let orig = d.get;
    let key = label || `get ${name}`;
    prof[key] = { calls: 0, ms: 0 };
    Object.defineProperty(obj, name, {
      ...d,
      get: function () {
        let t = now();
        try {
          return orig.call(this);
        } finally {
          let e = prof[key];
          e.calls++;
          e.ms += now() - t;
        }
      },
    });
  };
  let wrapSetter = (obj, name, label) => {
    let d = Object.getOwnPropertyDescriptor(obj, name);
    if (!d || typeof d.set !== 'function') return;
    let orig = d.set;
    let key = label || `set ${name}`;
    prof[key] = { calls: 0, ms: 0 };
    Object.defineProperty(obj, name, {
      ...d,
      set: function (v) {
        let t = now();
        try {
          orig.call(this, v);
        } finally {
          let e = prof[key];
          e.calls++;
          e.ms += now() - t;
        }
      },
    });
  };
  let E = Element.prototype,
    N = Node.prototype,
    D = Document.prototype;
  for (let m of [
    'querySelector',
    'querySelectorAll',
    'getElementsByTagName',
    'getElementsByClassName',
    'getAttribute',
    'setAttribute',
    'removeAttribute',
    'hasAttribute',
    'matches',
    'closest',
    'getBoundingClientRect',
    'getClientRects',
    'insertAdjacentHTML',
    'insertAdjacentElement',
    'append',
    'prepend',
    'remove',
    'replaceChildren',
    'animate',
    'scrollIntoView',
  ])
    wrapMethod(E, m, `Element.${m}`);
  for (let m of [
    'appendChild',
    'insertBefore',
    'removeChild',
    'replaceChild',
    'cloneNode',
    'contains',
    'compareDocumentPosition',
    'normalize',
  ])
    wrapMethod(N, m, `Node.${m}`);
  for (let m of [
    'createElement',
    'createElementNS',
    'createTextNode',
    'createComment',
    'createDocumentFragment',
    'createRange',
    'createTreeWalker',
    'getElementById',
    'querySelector',
    'querySelectorAll',
    'getElementsByTagName',
    'getElementsByClassName',
    'importNode',
    'adoptNode',
    'evaluate',
  ])
    wrapMethod(D, m, `Document.${m}`);
  for (let g of [
    'children',
    'childElementCount',
    'firstElementChild',
    'lastElementChild',
    'nextElementSibling',
    'previousElementSibling',
    'innerHTML',
    'outerHTML',
    'className',
    'classList',
    'clientWidth',
    'clientHeight',
    'scrollWidth',
    'scrollHeight',
    'scrollTop',
    'attributes',
    'tagName',
    'id',
    'dataset',
    'shadowRoot',
  ])
    wrapGetter(E, g, `Element.${g} (get)`);
  for (let g of [
    'childNodes',
    'firstChild',
    'lastChild',
    'nextSibling',
    'previousSibling',
    'parentNode',
    'parentElement',
    'textContent',
    'nodeType',
    'nodeName',
    'isConnected',
    'ownerDocument',
  ])
    wrapGetter(N, g, `Node.${g} (get)`);
  for (let s of ['innerHTML', 'outerHTML', 'className', 'id'])
    wrapSetter(E, s, `Element.${s} (set)`);
  wrapSetter(N, 'textContent', 'Node.textContent (set)');
  wrapSetter(CharacterData.prototype, 'data', 'CharacterData.data (set)');
  for (let g of [
    'offsetWidth',
    'offsetHeight',
    'offsetTop',
    'offsetLeft',
    'offsetParent',
    'innerText',
    'style',
  ])
    wrapGetter(HTMLElement.prototype, g, `HTMLElement.${g} (get)`);
  wrapMethod(HTMLElement.prototype, 'focus', 'HTMLElement.focus');
  wrapMethod(HTMLElement.prototype, 'click', 'HTMLElement.click');
  if (typeof HTMLCollection !== 'undefined') {
    wrapMethod(HTMLCollection.prototype, 'item', 'HTMLCollection.item');
    wrapGetter(
      HTMLCollection.prototype,
      'length',
      'HTMLCollection.length (get)',
    );
  }
  if (typeof NodeList !== 'undefined') {
    wrapMethod(NodeList.prototype, 'item', 'NodeList.item');
    wrapGetter(NodeList.prototype, 'length', 'NodeList.length (get)');
    wrapMethod(NodeList.prototype, 'forEach', 'NodeList.forEach');
  }
  if (typeof DOMTokenList !== 'undefined')
    for (let m of ['add', 'remove', 'toggle', 'contains'])
      wrapMethod(DOMTokenList.prototype, m, `DOMTokenList.${m}`);
  if (typeof CSSStyleDeclaration !== 'undefined')
    for (let m of ['setProperty', 'getPropertyValue', 'removeProperty'])
      wrapMethod(CSSStyleDeclaration.prototype, m, `CSSStyleDeclaration.${m}`);
  if (typeof EventTarget !== 'undefined')
    for (let m of ['addEventListener', 'removeEventListener', 'dispatchEvent'])
      wrapMethod(EventTarget.prototype, m, `EventTarget.${m}`);
  for (let f of [
    'getComputedStyle',
    'matchMedia',
    'requestAnimationFrame',
    'setTimeout',
    'fetch',
  ]) {
    let orig = globalThis[f];
    if (typeof orig === 'function') {
      prof[`window.${f}`] = { calls: 0, ms: 0 };
      globalThis[f] = function (...a) {
        let t = now();
        try {
          return orig.apply(this, a);
        } finally {
          let e = prof[`window.${f}`];
          e.calls++;
          e.ms += now() - t;
        }
      };
    }
  }
  if (typeof MutationObserver !== 'undefined') {
    let O = MutationObserver;
    prof['MutationObserver.observe'] = { calls: 0, ms: 0 };
    wrapMethod(O.prototype, 'observe', 'MutationObserver.observe');
  }
  if (typeof Range !== 'undefined')
    for (let m of [
      'createContextualFragment',
      'selectNode',
      'getBoundingClientRect',
      'setStart',
      'setEnd',
    ])
      wrapMethod(Range.prototype, m, `Range.${m}`);
  if (typeof XMLHttpRequest !== 'undefined')
    wrapMethod(XMLHttpRequest.prototype, 'send', 'XMLHttpRequest.send');
  globalThis.__domProfileTop = (k = 25) =>
    Object.entries(prof)
      .filter(([, v]) => v.calls > 0)
      .sort((a, b) => b[1].ms - a[1].ms)
      .slice(0, k)
      .map(([n, v]) => `${n}: ${v.calls} calls, ${Math.round(v.ms)}ms`);
  globalThis.__domProfileTotalMs = () =>
    Math.round(Object.values(prof).reduce((s, v) => s + v.ms, 0));
})();
