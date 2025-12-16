import { decodeScopedCSSRequest, isScopedCSSRequest } from 'glimmer-scoped-css';
import jsEscapeString from 'js-string-escape';

export async function maybeHandleScopedCSSRequest(req: Request) {
  let { pathname } = new URL(req.url);

  if (isScopedCSSRequest(pathname)) {
    if (typeof (globalThis as any).document == 'undefined') {
      // when run inside Node
      return Promise.resolve(new Response('', { status: 200 }));
    } else {
      let decodedCSS = decodeScopedCSSRequest(pathname).css;
      return Promise.resolve(
        new Response(`
          let styleNode = document.createElement('style');
          let styleText = document.createTextNode('${jsEscapeString(
            decodedCSS,
          )}');
          styleNode.appendChild(styleText);
          document.head.appendChild(styleNode);
        `),
      );
    }
  } else {
    return Promise.resolve(null);
  }
}
