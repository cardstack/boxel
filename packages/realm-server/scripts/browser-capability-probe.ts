// Probes a CDP browser endpoint for the Puppeteer surface, raw CDP domains,
// and Web APIs the prerender page pool and its diagnostics depend on, then
// records cold-session timings. Run it against a launched Chrome to get the
// baseline, and against another CDP-speaking engine to see what differs.
//
//   node scripts/browser-capability-probe.ts --launch
//   node scripts/browser-capability-probe.ts --ws ws://127.0.0.1:9224
//
// Options:
//   --origin <url>   where the probe's own HTTP server is reachable FROM THE
//                    BROWSER (default http://127.0.0.1:4299)
//   --port <n>       port the probe server binds (default 4299)
//   --out <file>     write the full JSON report here
//   --sessions <n>   cold-session timing iterations (default 5)
//   --skip <regex>   skip Puppeteer/CDP checks whose name matches

import puppeteer, {
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from 'puppeteer';
import http from 'http';
import { writeFileSync } from 'fs';
import { performance } from 'perf_hooks';

type Result = {
  name: string;
  ok: boolean;
  ms?: number;
  error?: string;
  value?: unknown;
};

let argv = process.argv.slice(2);
function opt(name: string, fallback?: string): string | undefined {
  let i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
}
let launch = argv.includes('--launch');
let wsEndpoint = opt('--ws');
let port = Number(opt('--port', '4299'));
let origin = opt('--origin', `http://127.0.0.1:${port}`)!;
let outFile = opt('--out');
let sessionIterations = Number(opt('--sessions', '5'));
let skipPattern = opt('--skip') ? new RegExp(opt('--skip')!) : undefined;
if (!launch && !wsEndpoint) {
  console.error('need --launch or --ws <endpoint>');
  process.exit(2);
}

// Hard stop so a wedged engine cannot hang the probe forever.
setTimeout(() => {
  console.error('probe: hard timeout, exiting');
  process.exit(3);
}, 240_000).unref();

const PROBE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>probe</title>
<style>
  :root { --brand: #123456; }
  #box { display: flex; width: 200px; height: 50px; }
  #box > span { flex: 1; }
</style>
</head>
<body>
<div id="box"><span>a</span><span>b</span></div>
<form id="f"><input id="inp" name="q" value="v"><select id="sel"><option>1</option><option selected>2</option></select></form>
<script>
  window.__probe = { ok: [], fail: [] };
  window.__probeDone = false;
  console.log('probe-console');
  setTimeout(() => { throw new Error('probe-uncaught'); }, 0);
  function rec(name, fn) {
    try {
      let v = fn();
      if (v && typeof v.then === 'function') {
        return Promise.race([
          v,
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 1500ms')), 1500)),
        ]).then(
          (r) => { if (r === false) window.__probe.fail.push({ name, error: 'returned false' }); else window.__probe.ok.push(name); },
          (e) => window.__probe.fail.push({ name, error: String(e && e.message || e).slice(0, 160) }),
        );
      }
      if (v === false) window.__probe.fail.push({ name, error: 'returned false' });
      else window.__probe.ok.push(name);
    } catch (e) {
      window.__probe.fail.push({ name, error: String(e && e.message || e).slice(0, 160) });
    }
    return Promise.resolve();
  }
  let box = document.getElementById('box');
  let pending = [];
  // --- DOM identity & Glimmer-relevant behaviour ---
  pending.push(rec('dom: node identity stable across queries', () => document.querySelector('#box') === box && document.body === document.body));
  pending.push(rec('dom: expando property persists', () => { box.__x = 1; return document.getElementById('box').__x === 1; }));
  pending.push(rec('dom: WeakMap keyed by node', () => { let m = new WeakMap(); m.set(document.body, 1); return m.get(document.querySelector('body')) === 1; }));
  pending.push(rec('dom: comment node + innerHTML serialization', () => { let d = document.createElement('div'); d.appendChild(document.createComment('%+b:0%')); d.appendChild(document.createTextNode('a<b')); return d.innerHTML === '<!--%+b:0%-->a&lt;b'; }));
  pending.push(rec('dom: attribute quoting round-trip', () => { let d = document.createElement('div'); d.innerHTML = '<p class="x" data-a="q&quot;z">hi</p>'; return d.firstChild.getAttribute('data-a') === 'q"z' && d.innerHTML === '<p class="x" data-a="q&quot;z">hi</p>'; }));
  pending.push(rec('dom: outerHTML', () => box.outerHTML.startsWith('<div id="box">')));
  pending.push(rec('dom: template.content + importNode', () => { let t = document.createElement('template'); t.innerHTML = '<span>1</span>'; return t.content.firstChild.tagName === 'SPAN' && document.importNode(t.content, true).childNodes.length === 1; }));
  pending.push(rec('dom: Range.createContextualFragment', () => { let r = document.createRange(); r.selectNode(document.body); let f = r.createContextualFragment('<b>x</b><!--c-->'); return f.childNodes.length === 2 && f.lastChild.nodeType === 8; }));
  pending.push(rec('dom: insertAdjacentHTML', () => { let d = document.createElement('div'); d.insertAdjacentHTML('afterbegin', '<i>1</i>'); d.insertAdjacentHTML('beforeend', '<i>2</i>'); return d.children.length === 2; }));
  pending.push(rec('dom: TreeWalker SHOW_COMMENT', () => { let d = document.createElement('div'); d.appendChild(document.createComment('c')); let w = document.createTreeWalker(d, NodeFilter.SHOW_COMMENT); return w.nextNode() && w.nextNode() === null; }));
  pending.push(rec('dom: insertBefore/removeChild/replaceChild', () => { let d = document.createElement('div'); let a = document.createElement('a'); let b = document.createElement('b'); d.insertBefore(a, null); d.insertBefore(b, a); d.replaceChild(document.createElement('i'), b); d.removeChild(a); return d.childNodes.length === 1 && d.firstChild.tagName === 'I'; }));
  pending.push(rec('dom: cloneNode deep', () => box.cloneNode(true).children.length === 2));
  pending.push(rec('dom: DocumentFragment append moves children', () => { let f = document.createDocumentFragment(); f.append(document.createElement('p'), 'text'); let d = document.createElement('div'); d.appendChild(f); return d.childNodes.length === 2 && f.childNodes.length === 0; }));
  pending.push(rec('dom: contains/isConnected/compareDocumentPosition', () => document.body.contains(box) && box.isConnected && (document.body.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_CONTAINED_BY) !== 0));
  pending.push(rec('dom: matches/closest', () => box.firstElementChild.matches('#box > span') && box.firstElementChild.closest('#box') === box));
  pending.push(rec('dom: classList/dataset/style', () => { box.classList.add('k'); box.dataset.foo = 'bar'; box.style.setProperty('--z', '1'); return box.classList.contains('k') && box.getAttribute('data-foo') === 'bar' && box.style.getPropertyValue('--z') === '1'; }));
  pending.push(rec('dom: getAttributeNames', () => box.getAttributeNames().includes('id')));
  pending.push(rec('dom: SVG namespace', () => { let s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 1 1'); s.innerHTML = '<path d="M0 0"/>'; return s.namespaceURI === 'http://www.w3.org/2000/svg' && s.firstChild.namespaceURI === 'http://www.w3.org/2000/svg' && s instanceof SVGElement; }));
  pending.push(rec('dom: DOMParser + XMLSerializer', () => { let doc = new DOMParser().parseFromString('<p>x</p>', 'text/html'); return doc.body.firstChild.tagName === 'P' && new XMLSerializer().serializeToString(doc.body.firstChild).includes('<p'); }));
  pending.push(rec('dom: Event bubbles to ancestor', () => { let hit = false; let inner = box.firstElementChild; let h = () => { hit = true; }; document.body.addEventListener('probe-b', h); inner.dispatchEvent(new Event('probe-b', { bubbles: true })); document.body.removeEventListener('probe-b', h); return hit; }));
  pending.push(rec('dom: non-bubbling event stays on target', () => { let hit = false; let inner = box.firstElementChild; let h = () => { hit = true; }; document.body.addEventListener('probe-nb', h); inner.dispatchEvent(new Event('probe-nb')); document.body.removeEventListener('probe-nb', h); return !hit; }));
  pending.push(rec('dom: CustomEvent detail', () => { let got; let h = (e) => { got = e.detail; }; box.addEventListener('probe-d', h); box.dispatchEvent(new CustomEvent('probe-d', { detail: { k: 2 } })); box.removeEventListener('probe-d', h); return got && got.k === 2; }));
  pending.push(rec('dom: addEventListener once', () => { let hits = 0; box.addEventListener('probe-o', () => { hits++; }, { once: true }); box.dispatchEvent(new Event('probe-o')); box.dispatchEvent(new Event('probe-o')); return hits === 1; }));
  pending.push(rec('dom: event.target/currentTarget/composedPath', () => { let ok = false; let inner = box.firstElementChild; let h = (e) => { ok = e.target === inner && e.currentTarget === box && e.composedPath().includes(document.body); }; box.addEventListener('probe-t', h); inner.dispatchEvent(new Event('probe-t', { bubbles: true })); box.removeEventListener('probe-t', h); return ok; }));
  pending.push(rec('dom: stopPropagation + preventDefault', () => { let outer = false; let inner = box.firstElementChild; let hi = (e) => { e.stopPropagation(); e.preventDefault(); }; let ho = () => { outer = true; }; inner.addEventListener('probe-s', hi); box.addEventListener('probe-s', ho); let ev = new Event('probe-s', { bubbles: true, cancelable: true }); let notCancelled = inner.dispatchEvent(ev); return !outer && notCancelled === false && ev.defaultPrevented; }));
  pending.push(rec('dom: click() dispatches click event', () => { let hit = false; let b = document.createElement('button'); b.addEventListener('click', () => { hit = true; }); document.body.appendChild(b); b.click(); return hit; }));
  pending.push(rec('dom: mouse/keyboard event ctors', () => new MouseEvent('click', { clientX: 1 }).clientX === 1 && new KeyboardEvent('keydown', { key: 'a' }).key === 'a' && typeof PointerEvent === 'function' && typeof FocusEvent === 'function' && typeof InputEvent === 'function'));
  pending.push(rec('dom: input value + input event', () => { let i = document.getElementById('inp'); let got = false; i.addEventListener('input', () => { got = true; }); i.value = 'w'; i.dispatchEvent(new Event('input', { bubbles: true })); return got && i.value === 'w' && document.getElementById('f').elements.length === 2 && document.getElementById('sel').value === '2'; }));
  pending.push(rec('dom: focus/activeElement', () => { let i = document.getElementById('inp'); i.focus(); return document.activeElement === i; }));
  pending.push(rec('dom: Object.defineProperty on HTMLElement.prototype', () => { Object.defineProperty(HTMLElement.prototype, '__pp', { get() { return 7; }, configurable: true }); return document.body.__pp === 7; }));
  pending.push(rec('dom: customElements define + connectedCallback', () => { let seen = false; customElements.define('probe-el', class extends HTMLElement { connectedCallback() { seen = true; } }); document.body.appendChild(document.createElement('probe-el')); return seen; }));
  pending.push(rec('dom: attachShadow', () => { let h = document.createElement('div'); let sr = h.attachShadow({ mode: 'open' }); sr.innerHTML = '<p>s</p>'; return sr.querySelector('p') !== null && h.shadowRoot === sr; }));
  pending.push(rec('dom: contentEditable property', () => 'contentEditable' in document.body && 'isContentEditable' in document.body));
  pending.push(rec('dom: execCommand exists', () => typeof document.execCommand === 'function'));
  pending.push(rec('dom: document.evaluate (XPath)', () => document.evaluate('//div[@id="box"]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue === box));
  // --- layout / CSSOM ---
  pending.push(rec('css: getComputedStyle display + custom property', () => getComputedStyle(box).display === 'flex' && getComputedStyle(box).getPropertyValue('--brand').trim() === '#123456'));
  pending.push(rec('css: offsetWidth/getBoundingClientRect', () => box.offsetWidth === 200 && box.getBoundingClientRect().width === 200 && box.clientHeight === 50));
  pending.push(rec('css: flex children split width', () => box.children[0].getBoundingClientRect().width === 100 && box.children[1].getBoundingClientRect().width === 100));
  pending.push(rec('css: document.styleSheets cssRules', () => document.styleSheets.length > 0 && document.styleSheets[0].cssRules.length >= 3));
  pending.push(rec('css: CSSStyleSheet ctor + adoptedStyleSheets', () => { let ss = new CSSStyleSheet(); ss.replaceSync('.a{color:red}'); document.adoptedStyleSheets = [ss]; return document.adoptedStyleSheets.length === 1; }));
  pending.push(rec('css: CSS.supports', () => CSS.supports('display', 'grid')));
  pending.push(rec('css: matchMedia', () => matchMedia('(min-width: 1px)').matches === true && typeof matchMedia('(prefers-color-scheme: dark)').addEventListener === 'function'));
  pending.push(rec('css: Element.animate/getAnimations', () => typeof box.animate === 'function' && typeof box.getAnimations === 'function'));
  pending.push(rec('css: scroll APIs', () => typeof box.scrollIntoView === 'function' && typeof window.scrollTo === 'function' && typeof box.scrollTo === 'function'));
  pending.push(rec('css: getSelection + Range rects', () => !!window.getSelection() && typeof document.createRange().getBoundingClientRect === 'function'));
  pending.push(rec('css: canvas 2d + toDataURL', () => { let c = document.createElement('canvas'); let g = c.getContext('2d'); return !!g && typeof g.fillRect === 'function' && c.toDataURL().startsWith('data:image/png'); }));
  // --- storage / navigation ---
  pending.push(rec('storage: localStorage/sessionStorage', () => { localStorage.setItem('p', '1'); sessionStorage.setItem('s', '2'); let ok = localStorage.getItem('p') === '1' && sessionStorage.getItem('s') === '2' && localStorage.length >= 1 && typeof localStorage.key(0) === 'string'; localStorage.removeItem('p'); return ok; }));
  pending.push(rec('storage: document.cookie', () => { document.cookie = 'pc=1; path=/'; return document.cookie.includes('pc=1'); }));
  pending.push(rec('nav: history pushState/state/replaceState', () => { history.pushState({ a: 1 }, '', '/probe.html?x=1'); let ok = location.search === '?x=1' && history.state && history.state.a === 1; history.replaceState(null, '', '/probe.html'); return ok && location.pathname === '/probe.html'; }));
  pending.push(rec('nav: URL/URLSearchParams', () => new URL('/a?b=1', location.href).searchParams.get('b') === '1'));
  // --- platform APIs ---
  pending.push(rec('api: Blob + createObjectURL', () => URL.createObjectURL(new Blob(['x'])).startsWith('blob:')));
  pending.push(rec('api: TextEncoder/Decoder', () => new TextDecoder().decode(new TextEncoder().encode('é')) === 'é'));
  pending.push(rec('api: structuredClone', () => structuredClone(new Map([[1, { a: [1] }]])).get(1).a[0] === 1));
  pending.push(rec('api: crypto.randomUUID/getRandomValues', () => crypto.randomUUID().length === 36 && crypto.getRandomValues(new Uint8Array(4)).length === 4));
  pending.push(rec('api: Intl', () => new Intl.DateTimeFormat('en-US').format(new Date(0)).length > 0 && new Intl.NumberFormat().format(1) === '1' && typeof Intl.Segmenter === 'function' && typeof Intl.RelativeTimeFormat === 'function'));
  pending.push(rec('api: performance.now', () => performance.now() > 0));
  pending.push(rec('api: performance.mark returns entry', () => { let m = performance.mark('m1'); return !!m && m.entryType === 'mark'; }));
  pending.push(rec('api: performance.measure + getEntriesByType', () => { performance.mark('m2'); performance.measure('ms', 'm2'); return performance.getEntriesByType('measure').length >= 1 && typeof performance.getEntriesByName === 'function' && Array.isArray(performance.getEntriesByType('navigation')); }));
  pending.push(rec('api: performance.timeOrigin + memory', () => typeof performance.timeOrigin === 'number'));
  pending.push(rec('api: PerformanceObserver ctor', () => { let o = new PerformanceObserver(() => {}); o.observe({ entryTypes: ['measure'] }); o.disconnect(); return true; }));
  pending.push(rec('api: AbortController', () => { let c = new AbortController(); c.abort(); return c.signal.aborted; }));
  pending.push(rec('api: MessageChannel', () => typeof new MessageChannel().port1.postMessage === 'function'));
  pending.push(rec('api: BroadcastChannel ctor', () => typeof BroadcastChannel === 'function' && new BroadcastChannel('p').name === 'p'));
  pending.push(rec('api: Worker/SharedWorker ctors exist', () => typeof Worker === 'function' && typeof SharedWorker !== 'undefined'));
  pending.push(rec('api: WebSocket ctor exists', () => typeof WebSocket === 'function'));
  pending.push(rec('api: EventSource ctor exists', () => typeof EventSource === 'function'));
  pending.push(rec('api: navigator.locks', () => !!navigator.locks && typeof navigator.locks.request === 'function'));
  pending.push(rec('api: navigator.clipboard', () => !!navigator.clipboard));
  pending.push(rec('api: navigator basics', () => typeof navigator.userAgent === 'string' && typeof navigator.language === 'string' && typeof navigator.onLine === 'boolean' && typeof navigator.hardwareConcurrency === 'number'));
  pending.push(rec('api: window metrics + visibility', () => typeof devicePixelRatio === 'number' && innerWidth > 0 && typeof document.hidden === 'boolean' && typeof document.visibilityState === 'string'));
  pending.push(rec('api: requestIdleCallback', () => typeof requestIdleCallback === 'function'));
  pending.push(rec('api: Notification ctor exists', () => typeof Notification !== 'undefined'));
  pending.push(rec('api: navigator.serviceWorker exists', () => !!navigator.serviceWorker));
  pending.push(rec('api: ResizeObserver/IntersectionObserver/MutationObserver ctors', () => typeof ResizeObserver === 'function' && typeof IntersectionObserver === 'function' && typeof MutationObserver === 'function'));
  pending.push(rec('api: FileReader ctor', () => typeof FileReader === 'function'));
  pending.push(rec('js: Proxy/WeakRef/FinalizationRegistry', () => typeof Proxy === 'function' && typeof WeakRef === 'function' && typeof FinalizationRegistry === 'function'));
  pending.push(rec('js: WebAssembly', () => typeof WebAssembly === 'object'));
  pending.push(rec('js: modern syntax + builtins', () => { class C { #p = 1; get p() { return this.#p; } } return new C().p === 1 && [1, 2].at(-1) === 2 && Object.hasOwn({ a: 1 }, 'a') && typeof Promise.withResolvers === 'function' && [3, 1].toSorted()[0] === 1 && 'a-b'.replaceAll('-', '_') === 'a_b'; }));
  pending.push(rec('js: Error.stack string', () => typeof new Error('e').stack === 'string' && new Error('e').stack.length > 0));
  pending.push(rec('js: Function.prototype.toString', () => (function foo() { return 1; }).toString().includes('foo')));
  pending.push(rec('js: globalThis.fetch replaceable', () => { let o = globalThis.fetch; globalThis.fetch = function () { return o.apply(this, arguments); }; let ok = globalThis.fetch !== o; globalThis.fetch = o; return ok; }));
  pending.push(rec('js: XMLHttpRequest.prototype.open patchable', () => { let o = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function () { return o.apply(this, arguments); }; let ok = XMLHttpRequest.prototype.open !== o; XMLHttpRequest.prototype.open = o; return ok; }));
  pending.push(rec('js: Date/timezone reports', () => { window.__tz = Intl.DateTimeFormat().resolvedOptions().timeZone; return true; }));
  pending.push(rec('js: eval + new Function', () => eval('1+1') === 2 && new Function('return 3')() === 3));
  // --- async ---
  pending.push(rec('async: setTimeout(0) fires', () => new Promise((r) => setTimeout(() => r(true), 0))));
  pending.push(rec('async: queueMicrotask before timeout', () => new Promise((r) => { let order = []; setTimeout(() => { order.push('t'); r(order.join('') === 'mt'); }, 0); queueMicrotask(() => order.push('m')); })));
  pending.push(rec('async: requestAnimationFrame fires', () => new Promise((r) => requestAnimationFrame((ts) => r(typeof ts === 'number')))));
  pending.push(rec('async: MutationObserver attrs+childList', () => new Promise((r) => { let d = document.createElement('div'); document.body.appendChild(d); let types = new Set(); let mo = new MutationObserver((recs) => { recs.forEach((m) => types.add(m.type)); if (types.has('attributes') && types.has('childList')) { mo.disconnect(); r(true); } }); mo.observe(d, { attributes: true, childList: true, subtree: true }); d.setAttribute('a', '1'); d.appendChild(document.createElement('i')); })));
  pending.push(rec('async: ResizeObserver fires', () => new Promise((r) => { let ro = new ResizeObserver((entries) => { ro.disconnect(); r(entries.length > 0 && typeof entries[0].contentRect.width === 'number'); }); ro.observe(box); })));
  pending.push(rec('async: IntersectionObserver fires', () => new Promise((r) => { let io = new IntersectionObserver((entries) => { io.disconnect(); r(entries.length > 0 && typeof entries[0].isIntersecting === 'boolean'); }); io.observe(box); })));
  pending.push(rec('async: fetch same-origin JSON + request headers echoed', () => fetch('/api/echo', { headers: { Authorization: 'Bearer probe', 'X-Probe': '1' }, method: 'POST', body: JSON.stringify({ a: 1 }) }).then((res) => res.json()).then((j) => { window.__echo = j; return j.headers.authorization === 'Bearer probe' && j.headers['x-probe'] === '1' && j.method === 'POST' && j.body === '{"a":1}'; })));
  pending.push(rec('async: fetch response text/arrayBuffer/blob', () => fetch('/api/echo').then((res) => Promise.all([res.clone().text(), res.clone().arrayBuffer(), res.blob()])).then(([t, ab, b]) => t.length > 0 && ab.byteLength === t.length && b.size === t.length)));
  pending.push(rec('async: fetch abort rejects AbortError', () => { let c = new AbortController(); let p = fetch('/api/slow', { signal: c.signal }); c.abort(); return p.then(() => false, (e) => e.name === 'AbortError'); }));
  pending.push(rec('async: XMLHttpRequest', () => new Promise((r) => { let x = new XMLHttpRequest(); x.open('GET', '/api/echo'); x.setRequestHeader('X-Xhr', '1'); x.onload = () => r(x.status === 200 && JSON.parse(x.responseText).headers['x-xhr'] === '1'); x.onerror = () => r(false); x.send(); })));
  pending.push(rec('async: EventSource receives message', () => new Promise((r) => { let es = new EventSource('/api/sse'); es.onmessage = (e) => { es.close(); r(e.data === 'hello'); }; es.onerror = () => { es.close(); r(false); }; })));
  pending.push(rec('async: dynamic import()', () => import('/dyn.mjs').then((m) => m.value === 42)));
  pending.push(rec('async: module script ran + import.meta.url', () => new Promise((r) => setTimeout(() => r(window.__moduleRan === true && typeof window.__importMetaUrl === 'string' && window.__importMetaUrl.endsWith('/probe.mjs')), 300))));
  pending.push(rec('async: indexedDB put/get', () => new Promise((r, j) => { let req = indexedDB.open('probe-db', 1); req.onupgradeneeded = () => req.result.createObjectStore('s'); req.onerror = () => j(req.error); req.onsuccess = () => { let db = req.result; let tx = db.transaction('s', 'readwrite'); tx.objectStore('s').put({ v: 1 }, 'k'); tx.oncomplete = () => { let g = db.transaction('s').objectStore('s').get('k'); g.onsuccess = () => r(g.result && g.result.v === 1); g.onerror = () => j(g.error); }; tx.onerror = () => j(tx.error); }; })));
  pending.push(rec('async: crypto.subtle.digest', () => crypto.subtle.digest('SHA-256', new TextEncoder().encode('hi')).then((buf) => buf.byteLength === 32)));
  pending.push(rec('async: unhandledrejection event fires', () => new Promise((r) => { window.addEventListener('unhandledrejection', function h(e) { if (e.reason && e.reason.message === 'probe-rej') { e.preventDefault(); window.removeEventListener('unhandledrejection', h); r(true); } }); Promise.reject(new Error('probe-rej')); })));
  pending.push(rec('async: window.onerror fires for async throw', () => new Promise((r) => { let prev = window.onerror; window.onerror = (msg) => { window.onerror = prev; r(String(msg).includes('probe-')); return true; }; setTimeout(() => { throw new Error('probe-onerror'); }, 0); })));
  pending.push(rec('async: popstate on history.back', () => new Promise((r) => { history.pushState({ b: 1 }, '', '/probe.html?back=1'); window.addEventListener('popstate', function h() { window.removeEventListener('popstate', h); r(location.search === ''); }); history.back(); })));
  pending.push(rec('async: hashchange', () => new Promise((r) => { window.addEventListener('hashchange', function h() { window.removeEventListener('hashchange', h); location.hash = ''; r(true); }); location.hash = '#probe'; })));
  pending.push(rec('async: <link rel=stylesheet> load event + applied', () => new Promise((r) => { let l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/late.css'; l.onload = () => r(getComputedStyle(box).outlineStyle === 'dotted'); l.onerror = () => r(false); document.head.appendChild(l); })));
  pending.push(rec('async: <img> data URI load', () => new Promise((r) => { let i = new Image(); i.onload = () => r(i.naturalWidth === 2); i.onerror = () => r(false); i.src = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>'); })));
  pending.push(rec('async: document.fonts.ready', () => document.fonts.ready.then(() => true)));
  pending.push(rec('async: Worker runs blob script', () => new Promise((r) => { try { let w = new Worker(URL.createObjectURL(new Blob(['postMessage(41+1)'], { type: 'text/javascript' }))); w.onmessage = (e) => { w.terminate(); r(e.data === 42); }; w.onerror = () => r(false); } catch (e) { r(false); } })));
  pending.push(rec('async: navigator.locks.request', () => navigator.locks.request('probe-lock', () => true)));
  Promise.allSettled(pending).then(() => { window.__probe.ua = navigator.userAgent; window.__probe.tz = window.__tz; window.__probeDone = true; });
</script>
<script type="module" src="/probe.mjs"></script>
</body></html>`;

function startProbeServer(): Promise<http.Server> {
  let server = http.createServer((req, res) => {
    let url = new URL(req.url ?? '/', 'http://x');
    let send = (status: number, type: string, body: string) => {
      res.writeHead(status, {
        'content-type': type,
        'cache-control': 'no-store',
      });
      res.end(body);
    };
    switch (url.pathname) {
      case '/probe.html':
        return send(200, 'text/html; charset=utf-8', PROBE_HTML);
      case '/blank.html':
        return send(
          200,
          'text/html; charset=utf-8',
          '<!doctype html><title>blank</title><p id="b">blank</p>',
        );
      case '/probe.mjs':
        return send(
          200,
          'text/javascript',
          "import { value } from './dyn.mjs'; window.__moduleRan = value === 42; window.__importMetaUrl = import.meta.url;",
        );
      case '/dyn.mjs':
        return send(200, 'text/javascript', 'export const value = 42;');
      case '/late.css':
        return send(200, 'text/css', '#box { outline: 1px dotted red; }');
      case '/api/echo': {
        let chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () =>
          send(
            200,
            'application/json',
            JSON.stringify({
              method: req.method,
              headers: req.headers,
              body: Buffer.concat(chunks).toString(),
            }),
          ),
        );
        return;
      }
      case '/api/slow':
        setTimeout(() => send(200, 'text/plain', 'slow'), 5000);
        return;
      case '/api/sse':
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
        });
        res.write('data: hello\n\n');
        setTimeout(() => res.end(), 2000);
        return;
      default:
        return send(404, 'text/plain', 'nope');
    }
  });
  return new Promise((resolve) =>
    server.listen(port, '0.0.0.0', () => resolve(server)),
  );
}

let results: {
  puppeteer: Result[];
  cdp: Result[];
  webapi: Result[];
  timings: Record<string, number[]>;
  info: Record<string, unknown>;
} = {
  puppeteer: [],
  cdp: [],
  webapi: [],
  timings: {},
  info: {},
};

async function check<T>(
  bucket: Result[],
  name: string,
  fn: () => Promise<T> | T,
  timeoutMs = 15_000,
): Promise<T | undefined> {
  if (skipPattern?.test(name)) {
    bucket.push({ name, ok: false, error: 'skipped (--skip)' });
    return undefined;
  }
  let t0 = performance.now();
  try {
    let v = await Promise.race([
      Promise.resolve().then(fn),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(`timeout ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
    let r: Result = { name, ok: true, ms: Math.round(performance.now() - t0) };
    if (v !== undefined && typeof v !== 'object') r.value = v;
    bucket.push(r);
    return v;
  } catch (e: any) {
    bucket.push({
      name,
      ok: false,
      ms: Math.round(performance.now() - t0),
      error: String(e?.message ?? e)
        .split('\n')[0]
        .slice(0, 200),
    });
    return undefined;
  }
}

function summarize(method: string, v: any): unknown {
  if (!v || typeof v !== 'object') return v;
  switch (method) {
    case 'Profiler.stop':
      return `nodes=${v.profile?.nodes?.length ?? 0} samples=${v.profile?.samples?.length ?? 0}`;
    case 'HeapProfiler.getSamplingProfile':
      return `headChildren=${v.profile?.head?.children?.length ?? 0} samples=${v.profile?.samples?.length ?? 0}`;
    case 'Performance.getMetrics':
      return `metrics=${(v.metrics ?? [])
        .map((m: any) => m.name)
        .slice(0, 12)
        .join(',')}${(v.metrics ?? []).length > 12 ? ',…' : ''}`;
    case 'Runtime.evaluate':
      return `value=${JSON.stringify(v.result?.value)}`;
    case 'Page.getLayoutMetrics':
      return `keys=${Object.keys(v).join(',')}`;
    case 'Browser.getVersion':
      return `${v.product} protocol=${v.protocolVersion}`;
    case 'Target.getTargets':
      return `targets=${v.targetInfos?.length}`;
    case 'DOM.getDocument':
      return `root=${v.root?.nodeName} children=${v.root?.childNodeCount}`;
    case 'DOMSnapshot.captureSnapshot':
      return `documents=${v.documents?.length} strings=${v.strings?.length}`;
    case 'Page.captureScreenshot':
      return `bytes=${v.data?.length}`;
    default:
      return undefined;
  }
}

async function cdp(
  client: CDPSession,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 8_000,
) {
  let v = await check(
    results.cdp,
    method,
    () => (client as any).send(method, params),
    timeoutMs,
  );
  let summary = summarize(method, v);
  if (summary !== undefined) {
    let r = results.cdp.find((x) => x.name === method);
    if (r) r.value = summary;
  }
  return v;
}

async function main() {
  let server = await startProbeServer();
  let browser: Browser | undefined;
  let t0 = performance.now();
  if (launch) {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  } else {
    browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint! });
  }
  results.timings['connect'] = [Math.round(performance.now() - t0)];
  results.info.version = await browser
    .version()
    .catch((e) => `ERR ${e.message}`);
  results.info.userAgent = await browser
    .userAgent()
    .catch((e) => `ERR ${e.message}`);
  results.info.mode = launch ? 'launch' : `connect ${wsEndpoint}`;

  let context = (await check(
    results.puppeteer,
    'browser.createBrowserContext',
    () => browser!.createBrowserContext(),
  )) as BrowserContext | undefined;
  let page: Page | undefined;
  if (context) {
    page = (await check(results.puppeteer, 'context.newPage', () =>
      context!.newPage(),
    )) as Page | undefined;
    if (page) {
      await check(
        results.puppeteer,
        'page.browserContext() === context',
        () => page!.browserContext() === context,
      );
    }
  }
  if (!page) {
    page = (await check(results.puppeteer, 'browser.newPage (fallback)', () =>
      browser!.newPage(),
    )) as Page | undefined;
  }
  if (!page) {
    throw new Error('could not get a page at all');
  }

  await check(results.puppeteer, 'page.evaluateOnNewDocument', () =>
    page!.evaluateOnNewDocument(() => {
      (globalThis as any).__boxelRenderContext = true;
    }),
  );
  await check(results.puppeteer, 'page.setViewport', () =>
    page!.setViewport({ width: 1280, height: 800 }),
  );
  await check(
    results.puppeteer,
    'page.viewport()',
    () => page!.viewport()?.width === 1280,
  );
  let consoleMessages: string[] = [];
  let pageErrors: string[] = [];
  let requestsFailed: string[] = [];
  let requestsSeen = 0;
  page.on('console', (m) => consoleMessages.push(m.text()));
  page.on('pageerror', (e) => pageErrors.push(String(e?.message ?? e)));
  page.on('requestfailed', (r) => requestsFailed.push(r.url()));
  page.on('request', () => requestsSeen++);

  // Raw CDP session attached before navigation, mirroring the pool's
  // runtime-exception capture and network in-flight tracker.
  let preNav = (await check(
    results.puppeteer,
    'page.createCDPSession (pre-nav)',
    () => page!.createCDPSession(),
  )) as CDPSession | undefined;
  let exceptionEvents = 0;
  let loadingFinished = 0;
  let requestWillBeSent = 0;
  if (preNav) {
    preNav.on('Runtime.exceptionThrown', () => exceptionEvents++);
    preNav.on('Network.loadingFinished', () => loadingFinished++);
    preNav.on('Network.requestWillBeSent', () => requestWillBeSent++);
    await cdp(preNav, 'Runtime.enable');
    await cdp(preNav, 'Network.enable');
  }

  let response = await check(
    results.puppeteer,
    'page.goto probe.html (domcontentloaded)',
    () =>
      page!.goto(`${origin}/probe.html`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      }),
    35_000,
  );
  await check(
    results.puppeteer,
    'response.status() === 200',
    () => (response as any)?.status() === 200,
  );
  await check(
    results.puppeteer,
    'page.waitForFunction(__probeDone)',
    () =>
      page!.waitForFunction(() => (window as any).__probeDone === true, {
        timeout: 20_000,
      }),
    25_000,
  );
  await check(results.puppeteer, 'evaluateOnNewDocument took effect', () =>
    page!.evaluate(() => (globalThis as any).__boxelRenderContext === true),
  );
  let inPage = (await check(
    results.puppeteer,
    'page.evaluate read in-page results',
    () => page!.evaluate(() => (window as any).__probe),
  )) as any;
  if (inPage) {
    for (let name of inPage.ok ?? []) results.webapi.push({ name, ok: true });
    for (let f of inPage.fail ?? [])
      results.webapi.push({ name: f.name, ok: false, error: f.error });
    results.info.inPageUserAgent = inPage.ua;
    results.info.timezone = inPage.tz;
  }
  await check(
    results.puppeteer,
    'page.evaluate with args + object return',
    async () => {
      let v = await page!.evaluate(
        (a: number, b: number) => ({
          sum: a + b,
          arr: [1, 2],
          n: null,
          d: new Date(0).toISOString(),
        }),
        1,
        2,
      );
      return (
        v.sum === 3 &&
        v.arr.length === 2 &&
        v.n === null &&
        v.d === '1970-01-01T00:00:00.000Z'
      );
    },
  );
  await check(results.puppeteer, 'page.evaluate async function', () =>
    page!.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return 'ok';
    }),
  );
  await check(
    results.puppeteer,
    'page.evaluate throw rejects with message',
    async () => {
      try {
        let v = await page!.evaluate(() => {
          throw new Error('boom');
        });
        return `RESOLVED with ${JSON.stringify(v)}`;
      } catch (e: any) {
        return String(e.message).includes('boom')
          ? true
          : `rejected: ${String(e.message).slice(0, 80)}`;
      }
    },
  );
  await check(
    results.puppeteer,
    'page.evaluate returns undefined',
    async () => {
      let v = await page!.evaluate(() => undefined);
      return v === undefined ? true : `got ${JSON.stringify(v)}`;
    },
  );
  await check(
    results.puppeteer,
    'page.evaluate rejected promise rejects',
    async () => {
      try {
        let v = await page!.evaluate(() => Promise.reject(new Error('rboom')));
        return `RESOLVED with ${JSON.stringify(v)}`;
      } catch (e: any) {
        return String(e.message).includes('rboom')
          ? true
          : `rejected: ${String(e.message).slice(0, 80)}`;
      }
    },
  );
  await check(
    results.puppeteer,
    'page.waitForFunction with arg + polling',
    async () => {
      await page!.evaluate(() =>
        setTimeout(() => {
          (window as any).__later = 'yes';
        }, 50),
      );
      let h = await page!.waitForFunction(
        (want: string) =>
          (window as any).__later === want ? { done: true } : false,
        { polling: 'raf', timeout: 5000 },
        'yes',
      );
      let v = await h.jsonValue();
      return (v as any)?.done === true;
    },
  );
  await check(results.puppeteer, 'page.waitForSelector', () =>
    page!.waitForSelector('#box', { timeout: 5000 }),
  );
  await check(results.puppeteer, 'page.$ + boundingBox', async () => {
    let h = await page!.$('#box');
    let bb = await h?.boundingBox();
    return bb?.width === 200;
  });
  await check(results.puppeteer, 'page.$$eval', () =>
    page!.$$eval('#box > span', (els) => els.length),
  );
  await check(
    results.puppeteer,
    'page.title/url/content',
    async () =>
      (await page!.title()) === 'probe' &&
      page!.url().startsWith(origin) &&
      (await page!.content()).includes('<div id="box"'),
  );
  await check(
    results.puppeteer,
    'page.screenshot base64',
    async () =>
      ((await page!.screenshot({ encoding: 'base64' })) as string).length > 100,
  );
  await check(
    results.puppeteer,
    'page.screenshot clip',
    async () =>
      (
        (await page!.screenshot({
          encoding: 'base64',
          clip: { x: 0, y: 0, width: 50, height: 50 },
        })) as string
      ).length > 50,
  );
  await check(results.puppeteer, 'page.exposeFunction', async () => {
    await page!.exposeFunction('probeExposed', (x: number) => x * 2);
    return (
      (await page!.evaluate(() => (window as any).probeExposed(21))) === 42
    );
  });
  await check(
    results.puppeteer,
    'page.setExtraHTTPHeaders reaches fetch',
    async () => {
      await page!.setExtraHTTPHeaders({ 'x-extra': '1' });
      let j = await page!.evaluate(() =>
        fetch('/api/echo').then((r) => r.json()),
      );
      await page!.setExtraHTTPHeaders({});
      return j.headers['x-extra'] === '1';
    },
  );
  await check(
    results.puppeteer,
    'page.setRequestInterception adds header',
    async () => {
      await page!.setRequestInterception(true);
      let handler = (req: any) => {
        req.continue({ headers: { ...req.headers(), 'x-intercepted': 'yes' } });
      };
      page!.on('request', handler);
      try {
        let j = await page!.evaluate(() =>
          fetch('/api/echo').then((r) => r.json()),
        );
        return j.headers['x-intercepted'] === 'yes';
      } finally {
        page!.off('request', handler);
        await page!.setRequestInterception(false);
      }
    },
  );
  await check(results.puppeteer, 'page.setCacheEnabled(false)', () =>
    page!.setCacheEnabled(false),
  );
  await check(results.puppeteer, 'localStorage survives reload', async () => {
    await page!.evaluate(() => localStorage.setItem('boxel-session', 'tok'));
    await page!.reload({ waitUntil: 'domcontentloaded' });
    return (
      (await page!.evaluate(() => localStorage.getItem('boxel-session'))) ===
      'tok'
    );
  });
  await check(
    results.puppeteer,
    'localStorage isolated per browser context',
    async () => {
      let ctx2 = await browser!.createBrowserContext();
      try {
        let p2 = await ctx2.newPage();
        await p2.goto(`${origin}/blank.html`, {
          waitUntil: 'domcontentloaded',
        });
        let v = await p2.evaluate(() => localStorage.getItem('boxel-session'));
        return v === null;
      } finally {
        await ctx2.close().catch(() => {});
      }
    },
  );
  await check(results.puppeteer, 'console events received', () =>
    consoleMessages.some((m) => m.includes('probe-console')),
  );
  await check(results.puppeteer, 'pageerror events received', () =>
    pageErrors.some((m) => m.includes('probe-')),
  );
  await check(
    results.puppeteer,
    'request events received',
    () => requestsSeen > 0,
  );
  await check(
    results.puppeteer,
    'Runtime.exceptionThrown events received',
    () => exceptionEvents > 0,
  );
  await check(
    results.puppeteer,
    'Network.requestWillBeSent/loadingFinished events received',
    () => requestWillBeSent > 0 && loadingFinished > 0,
  );
  results.info.requestsFailed = requestsFailed.slice(0, 10);
  results.info.pageErrors = pageErrors.slice(0, 10);
  results.info.consoleSample = consoleMessages.slice(0, 10);

  // Raw CDP surface the diagnostics tooling uses.
  let client = (await check(
    results.puppeteer,
    'page.createCDPSession (diagnostics)',
    () => page!.createCDPSession(),
  )) as CDPSession | undefined;
  if (client) {
    await cdp(client, 'Browser.getVersion');
    await cdp(client, 'Target.getTargets');
    await cdp(client, 'Page.enable');
    await cdp(client, 'Page.setLifecycleEventsEnabled', { enabled: true });
    await cdp(client, 'Page.getLayoutMetrics');
    await cdp(client, 'Page.addScriptToEvaluateOnNewDocument', {
      source: 'globalThis.__x = 1',
    });
    await cdp(client, 'Page.captureScreenshot', { format: 'png' });
    await cdp(client, 'Page.setBypassCSP', { enabled: true });
    await cdp(client, 'Runtime.evaluate', {
      expression: '1+1',
      returnByValue: true,
    });
    await cdp(client, 'Runtime.getHeapUsage');
    await cdp(client, 'Runtime.addBinding', { name: 'probeBinding' });
    await cdp(client, 'Network.setExtraHTTPHeaders', {
      headers: { 'x-cdp': '1' },
    });
    await cdp(client, 'Network.setCacheDisabled', { cacheDisabled: true });
    await cdp(client, 'Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await cdp(client, 'Fetch.disable');
    await cdp(client, 'DOM.enable');
    await cdp(client, 'DOM.getDocument', { depth: 1 });
    await cdp(client, 'DOMSnapshot.captureSnapshot', { computedStyles: [] });
    await cdp(client, 'Log.enable');
    await cdp(client, 'Console.enable');
    await cdp(client, 'Security.setIgnoreCertificateErrors', { ignore: true });
    await cdp(client, 'Storage.clearDataForOrigin', {
      origin,
      storageTypes: 'local_storage',
    });
    await cdp(client, 'Emulation.setDeviceMetricsOverride', {
      width: 800,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp(client, 'Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
    await cdp(client, 'Performance.enable');
    await cdp(client, 'Performance.getMetrics');
    await cdp(client, 'Profiler.enable');
    await cdp(client, 'Profiler.setSamplingInterval', { interval: 1000 });
    let started = await cdp(client, 'Profiler.start');
    if (started !== undefined) {
      await page.evaluate(() => {
        let s = 0;
        for (let i = 0; i < 1e5; i++) s += i;
        return s;
      });
      await cdp(client, 'Profiler.stop');
    }
    await cdp(client, 'Profiler.disable');
    await cdp(client, 'HeapProfiler.enable');
    let sampling = await cdp(client, 'HeapProfiler.startSampling', {
      samplingInterval: 32768,
    });
    if (sampling !== undefined) {
      await cdp(client, 'HeapProfiler.getSamplingProfile');
      await cdp(client, 'HeapProfiler.stopSampling');
    }
    let tracing = await cdp(client, 'Tracing.start', {
      transferMode: 'ReturnAsStream',
      traceConfig: { includedCategories: ['devtools.timeline', 'v8.execute'] },
    });
    if (tracing !== undefined) {
      let done = new Promise((r) => client!.once('Tracing.tracingComplete', r));
      await cdp(client, 'Tracing.end');
      await check(
        results.cdp,
        'Tracing.tracingComplete event',
        () => done,
        10_000,
      );
    }
    let dbg = await cdp(client, 'Debugger.enable');
    if (dbg !== undefined) {
      let paused = new Promise((r) => client!.once('Debugger.paused', r));
      void (client as any).send('Debugger.pause').catch(() => {});
      // A paused isolate needs something to pause IN; give it a busy loop.
      void page
        .evaluate(() => {
          let t = Date.now();
          while (Date.now() - t < 300) {
            // spin so the debugger has JS to pause in
          }
        })
        .catch(() => {});
      await check(results.cdp, 'Debugger.paused event', () => paused, 5_000);
      await cdp(client, 'Debugger.resume');
      await cdp(client, 'Debugger.disable');
    }
    await check(results.puppeteer, 'cdpSession.detach', () => client!.detach());
  }

  await check(
    results.puppeteer,
    'page.isClosed() false before close',
    () => page!.isClosed() === false,
  );
  await check(results.puppeteer, 'page.close', () => page!.close());
  await check(
    results.puppeteer,
    'page.isClosed() true after close',
    () => page!.isClosed() === true,
  );
  if (context) {
    await check(results.puppeteer, 'context.close', () => context!.close());
  }

  // Cold-session timings: the pool's per-standby cost.
  let cold: number[] = [];
  let coldParts: {
    context: number[];
    newPage: number[];
    goto: number[];
    evaluate: number[];
    close: number[];
  } = { context: [], newPage: [], goto: [], evaluate: [], close: [] };
  for (let i = 0; i < sessionIterations; i++) {
    try {
      let s = performance.now();
      let c = await browser.createBrowserContext();
      let a = performance.now();
      let p = await c.newPage();
      let b = performance.now();
      await p.goto(`${origin}/blank.html`, {
        waitUntil: 'domcontentloaded',
        timeout: 20_000,
      });
      let d = performance.now();
      await p.evaluate(() => document.getElementById('b')?.textContent);
      let e = performance.now();
      await c.close();
      let f = performance.now();
      cold.push(Math.round(e - s));
      coldParts.context.push(Math.round(a - s));
      coldParts.newPage.push(Math.round(b - a));
      coldParts.goto.push(Math.round(d - b));
      coldParts.evaluate.push(Math.round(e - d));
      coldParts.close.push(Math.round(f - e));
    } catch (e: any) {
      results.puppeteer.push({
        name: `cold session #${i + 1}`,
        ok: false,
        error: String(e?.message ?? e).slice(0, 200),
      });
    }
  }
  results.timings['cold session total (ctx+page+goto+evaluate)'] = cold;
  for (let [k, v] of Object.entries(coldParts)) results.timings[`  ${k}`] = v;

  // Warm reuse: same page, re-navigate.
  try {
    let c = await browser.createBrowserContext();
    let p = await c.newPage();
    await p.goto(`${origin}/blank.html`, { waitUntil: 'domcontentloaded' });
    let warm: number[] = [];
    for (let i = 0; i < sessionIterations; i++) {
      let s = performance.now();
      await p.goto(`${origin}/blank.html?i=${i}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20_000,
      });
      await p.evaluate(() => 1);
      warm.push(Math.round(performance.now() - s));
    }
    results.timings['warm page re-navigate + evaluate'] = warm;
    await c.close();
  } catch (e: any) {
    results.puppeteer.push({
      name: 'warm re-navigate',
      ok: false,
      error: String(e?.message ?? e).slice(0, 200),
    });
  }

  if (launch) {
    await browser.close();
  } else {
    await browser.disconnect();
  }
  server.close();
  report();
}

function report() {
  let line = (r: Result) =>
    `  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ms !== undefined ? ` (${r.ms}ms)` : ''}${r.value !== undefined ? ` -> ${JSON.stringify(r.value)}` : ''}${r.error ? `  :: ${r.error}` : ''}`;
  console.log(`\n== info ==\n${JSON.stringify(results.info, null, 2)}`);
  for (let bucket of ['puppeteer', 'cdp', 'webapi'] as const) {
    let rs = results[bucket];
    let pass = rs.filter((r) => r.ok).length;
    console.log(`\n== ${bucket}: ${pass}/${rs.length} pass ==`);
    for (let r of rs) console.log(line(r));
  }
  console.log('\n== timings (ms) ==');
  for (let [k, v] of Object.entries(results.timings)) {
    let sorted = [...v].sort((a, b) => a - b);
    let median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN;
    console.log(`  ${k}: median ${median}  all [${v.join(', ')}]`);
  }
  if (outFile) {
    writeFileSync(outFile, JSON.stringify(results, null, 2));
    console.log(`\nwrote ${outFile}`);
  }
}

main().catch((e) => {
  console.error('probe failed:', e);
  report();
  process.exit(1);
});
