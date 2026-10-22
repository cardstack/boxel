// Links each page's cascade layer order (`src/styles/layers.css`) as the
// page's first stylesheet.
//
// The browser orders cascade layers by where each is first named, across all
// of a page's stylesheets in the order they are linked. The build links the
// stylesheets it emits in an order of its own, after the page's own links, so
// a stylesheet that names a component layer can come before the one that
// names the layers beneath it, and a reset would then win over the
// components it is meant to sit under. Moving the order's link ahead of every
// other stylesheet makes it the first to name any layer. The policy refuses
// an inline `<style>`, so the order is a file of its own.
import type { Plugin } from 'vite';

const LAYERS_LINK = /\s*<link\b[^>]*\bhref="[^"]*\/layers\.css"[^>]*>/;
const FIRST_STYLESHEET = /<link\b[^>]*\brel="stylesheet"/;

export function layerOrderFirst(): Plugin {
  return {
    name: 'secure-origin-layer-order-first',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, { filename }) {
        let link = html.match(LAYERS_LINK);
        if (!link) {
          throw new Error(
            `${filename} links no layers.css: its entry must import src/styles/layers.css first`,
          );
        }
        let rest = html.replace(link[0], '');
        let first = rest.match(FIRST_STYLESHEET);
        if (!first || first.index === undefined) {
          return html;
        }
        return `${rest.slice(0, first.index)}${link[0].trim()}\n    ${rest.slice(first.index)}`;
      },
    },
  };
}
