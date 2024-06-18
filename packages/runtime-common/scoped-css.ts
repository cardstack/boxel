import { decodeScopedCSSRequest, isScopedCSSRequest } from 'glimmer-scoped-css';
import jsEscapeString from 'js-string-escape';

export async function maybeHandleScopedCSSRequest(req: Request) {
  if (isScopedCSSRequest(req.url)) {
    // isFastBoot doesn’t work here because this runs outside FastBoot but inside Node
    if (typeof (globalThis as any).document == 'undefined') {
      return Promise.resolve(new Response('', { status: 200 }));
    } else {
      let decodedCSS = decodeScopedCSSRequest(req.url).css;
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
