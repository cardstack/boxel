import { decodeScopedCSSRequest, isScopedCSSRequest } from 'glimmer-scoped-css';
import jsEscapeString from 'js-string-escape';

export async function maybeHandleScopedCSSRequest(req: Request) {
  if (isScopedCSSRequest(req.url)) {
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
  } else {
    return Promise.resolve(null);
  }
}
