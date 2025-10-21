import { decodeScopedCSSRequest, isScopedCSSRequest } from 'glimmer-scoped-css';
import jsEscapeString from 'js-string-escape';

export async function maybeHandleScopedCSSRequest(req: Request) {
  if (isScopedCSSRequest(req.url)) {
    // isFastBoot doesn’t work here because this runs outside FastBoot but inside Node
    if (typeof (globalThis as any).document == 'undefined') {
      return Promise.resolve(new Response('', { status: 200 }));
    } else {
      let decoded = decodeScopedCSSRequest(req.url);
      let css = decoded.css;
      // Each scoped block receives a unique data-scopedcss-* attribute from the AST transform.
      // We use that attribute as the key for the <style> element we keep in <head>; falling back
      // to the original filename keeps legacy behaviour if the transform ever changes.
      let attrMatch = css.match(/data-scopedcss-[0-9a-f]{10}-[0-9a-f]{10}/);
      let key = attrMatch ? attrMatch[0] : decoded.fromFile;
      return Promise.resolve(
        new Response(`
          (function() {
            const css = '${jsEscapeString(css)}';
            const key = '${jsEscapeString(key)}';
            const doc = document;
            let styleNode = doc.head.querySelector('style[data-boxel-scoped-css="' + key + '"]');
            if (!styleNode) {
              styleNode = doc.createElement('style');
              styleNode.setAttribute('data-boxel-scoped-css', key);
              doc.head.appendChild(styleNode);
            }
            if (styleNode.textContent !== css) {
              styleNode.textContent = css;
            }
          })();
        `),
      );
    }
  } else {
    return Promise.resolve(null);
  }
}
