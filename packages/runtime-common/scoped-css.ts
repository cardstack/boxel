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
      let key = decoded.fromFile;
      return Promise.resolve(
        new Response(`
          (function() {
            const css = '${jsEscapeString(css)}';
            const key = '${jsEscapeString(key)}';
            const doc = document;
            // We leave a keyed <style> tag in <head> so repeated renders just mutate it
            // instead of appending duplicates. Ember’s teardown can still succeed because
            // we leave behind a stub in the original location (see below).
            let styleNode = doc.head.querySelector('style[data-boxel-scoped-css="' + key + '"]');
            if (!styleNode) {
              styleNode = doc.createElement('style');
              styleNode.setAttribute('data-boxel-scoped-css', key);
              doc.head.appendChild(styleNode);
            }
            if (styleNode.textContent !== css) {
              styleNode.textContent = css;
            }
            const insertStub = (parent, beforeNode) => {
              if (!parent) {
                return;
              }
              let existingStub = parent.querySelector('style[data-boxel-scoped-css-stub="' + key + '"]');
              if (existingStub) {
                return;
              }
              const stub = doc.createElement('style');
              stub.setAttribute('data-boxel-scoped-css-stub', key);
              parent.insertBefore(stub, beforeNode);
            };
            const currentScript = doc.currentScript;
            if (currentScript && currentScript.parentNode) {
              insertStub(currentScript.parentNode, currentScript);
              currentScript.remove();
            } else {
              // Fallback: derive the scoped attribute from the CSS selectors and insert the stub
              // before the first element that carries it. This mirrors where the original <style>
              // would have lived in the template tree.
              const attrMatch = css.match(/data-scopedcss-[0-9a-f]{10}-[0-9a-f]{10}/);
              if (attrMatch) {
                const attrName = attrMatch[0];
                const host = doc.querySelector('[' + attrName + ']');
                if (host && host.parentNode) {
                  insertStub(host.parentNode, host);
                }
              }
            }
          })();
        `),
      );
    }
  } else {
    return Promise.resolve(null);
  }
}
