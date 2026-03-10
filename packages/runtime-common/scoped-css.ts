import { decodeScopedCSSRequest, isScopedCSSRequest } from 'glimmer-scoped-css';
import jsEscapeString from 'js-string-escape';

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
  for (let styleNode of document.querySelectorAll(
    `style[${SCOPED_CSS_ATTR}]`,
  )) {
    styleNode.remove();
  }
  resetScopedCSSRegistry();
}

export async function maybeHandleScopedCSSRequest(req: Request) {
  let { pathname } = new URL(req.url);

  if (isScopedCSSRequest(pathname)) {
    if (typeof (globalThis as any).document == 'undefined') {
      // when run inside Node
      return Promise.resolve(new Response('', { status: 200 }));
    } else {
      let decodedCSS = decodeScopedCSSRequest(pathname).css;
      let escapedPathname = jsEscapeString(pathname);
      return Promise.resolve(
        new Response(`
          let registry = globalThis.${SCOPED_CSS_REGISTRY_KEY};
          if (!(registry instanceof Map)) {
            registry = new Map();
            globalThis.${SCOPED_CSS_REGISTRY_KEY} = registry;
          }
          let key = '${escapedPathname}';
          let existingStyleNode = registry.get(key);
          if (!existingStyleNode || !document.head.contains(existingStyleNode)) {
            let styleNode = document.createElement('style');
            let styleText = document.createTextNode('${jsEscapeString(
              decodedCSS,
            )}');
            styleNode.setAttribute('${SCOPED_CSS_ATTR}', key);
            styleNode.appendChild(styleText);
            document.head.appendChild(styleNode);
            registry.set(key, styleNode);
          }
        `),
      );
    }
  } else {
    return Promise.resolve(null);
  }
}
