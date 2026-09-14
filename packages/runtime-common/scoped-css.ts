import jsEscapeString from 'js-string-escape';

// Pure request helpers. Re-implemented locally so that importing `scoped-css`
// from the browser does not drag in `glimmer-scoped-css`'s CJS entry (which
// transitively requires `postcss` → `source-map-js`). The glimmer-scoped-css
// package emits URLs ending in `.glimmer-scoped.css` with the encoded CSS
// baked into the filename; decoding is just a base64-ish round-trip.
//
// Scoped-CSS requests come in two forms:
//
// - inline: `<fromFile>.<base64 payload>.glimmer-scoped.css` — the form
//   `glimmer-scoped-css` emits into transpiled module source. The whole
//   stylesheet rides in the URL, so it decodes with no lookup.
// - hashed: `<fromFile>.md5-<32 hex>.glimmer-scoped.css` — the form the index
//   writer persists into `deps` (see `scoped_css` table). The URL carries only
//   a content hash; the CSS bytes live in the `scoped_css` table and the realm
//   serves the request by hash lookup.
const SCOPED_CSS_PATTERN = /^(.*)\.([^.]*)\.glimmer-scoped.css$/;
const HASHED_SCOPED_CSS_PATTERN =
  /^(.*)\.md5-([0-9a-f]{32})\.glimmer-scoped.css$/;

export function isScopedCSSRequest(request: string): boolean {
  return request.endsWith('.glimmer-scoped.css');
}

export function isHashedScopedCSSRequest(request: string): boolean {
  return HASHED_SCOPED_CSS_PATTERN.test(request);
}

export function encodeHashedScopedCSSRequest(
  fromFile: string,
  cssHash: string,
): string {
  return `${fromFile}.md5-${cssHash}.glimmer-scoped.css`;
}

export type ScopedCSSRequest =
  | { form: 'inline'; fromFile: string; css: string }
  | { form: 'hashed'; fromFile: string; cssHash: string };

export function parseScopedCSSRequest(request: string): ScopedCSSRequest {
  let hashed = HASHED_SCOPED_CSS_PATTERN.exec(request);
  if (hashed) {
    return { form: 'hashed', fromFile: hashed[1], cssHash: hashed[2] };
  }
  let m = SCOPED_CSS_PATTERN.exec(request);
  if (!m) {
    throw new Error(`not a scoped CSS request: ${request}`);
  }
  let binString = atob(decodeURIComponent(m[2]));
  let css = new TextDecoder().decode(
    Uint8Array.from(binString, (c) => c.codePointAt(0)!),
  );
  return { form: 'inline', fromFile: m[1], css };
}

export function decodeScopedCSSRequest(request: string): {
  fromFile: string;
  css: string;
} {
  let parsed = parseScopedCSSRequest(request);
  if (parsed.form !== 'inline') {
    throw new Error(
      `scoped CSS request carries a content hash, not inline CSS: ${request}`,
    );
  }
  return { fromFile: parsed.fromFile, css: parsed.css };
}

const SCOPED_CSS_ATTR = 'data-boxel-scoped-css';
const SCOPED_CSS_REGISTRY_KEY = '__boxelScopedCSSRegistry';

function resetScopedCSSRegistry() {
  let registry = (globalThis as Record<string, unknown>)[
    SCOPED_CSS_REGISTRY_KEY
  ];
  if (registry instanceof Map) {
    registry.clear();
  }
}

export function clearInjectedScopedCSS() {
  if (typeof document === 'undefined') {
    return;
  }
  for (let styleNode of Array.from(
    document.querySelectorAll(`style[${SCOPED_CSS_ATTR}]`),
  )) {
    styleNode.remove();
  }
  resetScopedCSSRegistry();
}

// The JS module body that injects a scoped stylesheet into `document.head`
// (once per pathname, tracked in a global registry). Served for both request
// forms: built locally for inline requests, and by the realm's hashed-request
// route after it looks the CSS up by hash.
export function scopedCSSInjectorSource(pathname: string, css: string): string {
  let escapedPathname = jsEscapeString(pathname);
  return `
          let registry = globalThis.${SCOPED_CSS_REGISTRY_KEY};
          if (!(registry instanceof Map)) {
            registry = new Map();
            globalThis.${SCOPED_CSS_REGISTRY_KEY} = registry;
          }
          let key = '${escapedPathname}';
          let existingStyleNode = registry.get(key);
          if (!existingStyleNode || !document.head.contains(existingStyleNode)) {
            let styleNode = document.createElement('style');
            let styleText = document.createTextNode('${jsEscapeString(css)}');
            styleNode.setAttribute('${SCOPED_CSS_ATTR}', key);
            styleNode.appendChild(styleText);
            document.head.appendChild(styleNode);
            registry.set(key, styleNode);
          }
        `;
}

export async function maybeHandleScopedCSSRequest(req: Request) {
  let { pathname } = new URL(req.url);

  if (isScopedCSSRequest(pathname)) {
    if (typeof (globalThis as any).document == 'undefined') {
      // when run inside Node
      return Promise.resolve(new Response('', { status: 200 }));
    } else if (isHashedScopedCSSRequest(pathname)) {
      // The CSS bytes aren't in the URL — fall through to the network so the
      // realm can serve the injector module from its `scoped_css` table.
      return Promise.resolve(null);
    } else {
      let decodedCSS = decodeScopedCSSRequest(pathname).css;
      return Promise.resolve(
        new Response(scopedCSSInjectorSource(pathname, decodedCSS)),
      );
    }
  } else {
    return Promise.resolve(null);
  }
}
