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
//
// A layer the order doesn't name would sort wherever it is first named, so
// the build fails on any stylesheet that names one: Pret UI's and boxel-ui's
// as well as the package's own.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Plugin } from 'vite';

import { PACKAGE_ROOT } from './module-package.ts';

export const LAYERS_FILE = join(PACKAGE_ROOT, 'src', 'styles', 'layers.css');

// Each cascade layer `css` names, in a statement or a block. A nested layer
// is named by its full dotted name.
export function layersNamed(css: string): string[] {
  let source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let names = new Set<string>();
  for (let [, list] of source.matchAll(/@layer\s+([^;{]+)[;{]/g)) {
    for (let name of list.split(',')) {
      if (name.trim()) {
        names.add(name.trim());
      }
    }
  }
  return [...names];
}

// Why the layers `css` names can't be ordered by `order`, the layers
// `layers.css` names, or undefined when they can.
export function unorderedLayers(
  stylesheet: string,
  css: string,
  order: string[],
): string | undefined {
  let unnamed = layersNamed(css).filter(
    (name) => !order.includes(name.split('.')[0]),
  );
  return unnamed.length > 0
    ? `${stylesheet} names the cascade layer${unnamed.length > 1 ? 's' : ''} ${unnamed.join(', ')}, which src/styles/layers.css doesn't order`
    : undefined;
}

const LAYERS_LINK = /\s*<link\b[^>]*\bhref="[^"]*\/layers\.css"[^>]*>/;
const FIRST_STYLESHEET = /<link\b[^>]*\brel="stylesheet"/;

export function layerOrderFirst(): Plugin {
  return {
    name: 'secure-origin-layer-order-first',
    apply: 'build',
    generateBundle(_options, bundle) {
      let order = layersNamed(readFileSync(LAYERS_FILE, 'utf8'));
      let refused: string[] = [];
      for (let [fileName, output] of Object.entries(bundle)) {
        if (output.type === 'asset' && fileName.endsWith('.css')) {
          let reason = unorderedLayers(fileName, String(output.source), order);
          if (reason) {
            refused.push(reason);
          }
        }
      }
      if (refused.length > 0) {
        this.error(refused.join('\n'));
      }
    },
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
