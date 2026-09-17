// A base module compiled into the host bundle keeps its scoped CSS — the
// bundler resolves the stylesheet into the build like any other import — but
// it stops *reporting* that stylesheet. glimmer-scoped-css emits the CSS as an
// import specifier with the stylesheet encoded into it, and a module the
// loader fetches records that specifier among its consumed modules. A shimmed
// module records nothing, so the indexer never learns the stylesheet exists
// and a card's served HTML arrives without the CSS its base components need.
//
// The specifier is in the module's own compiled source, right up until the
// bundler resolves it away. So rather than collect the specifiers at build
// time — which cannot work, because they are discovered while the graph is
// walked and would be needed before that walk finishes — each base module
// carries its own: this appends a registration that runs when the module is
// evaluated. By the time the loader records what a shimmed module consumed,
// its chunk has executed and its specifiers are on the registry.
import { sep } from 'node:path';

const REGISTRY = '__boxelBundledBaseScopedCSS';

// `<fromFile>.<encoded stylesheet>.glimmer-scoped.css` wherever it appears as
// a string in the compiled module. A stylesheet is imported for its side
// effect, so the import carries no `from` clause to anchor on.
const SCOPED_CSS_IMPORT = /["']([^"']*\.glimmer-scoped\.css)["']/g;

function isBaseModule(id) {
  return (
    id.includes(`${sep}packages${sep}base${sep}`) && /\.(gts|ts)(\?|$)/.test(id)
  );
}

// `/abs/packages/base/date/day.gts` → `date/day`, the key the bundled module
// table uses.
function baseModuleName(id) {
  let marker = `${sep}packages${sep}base${sep}`;
  let tail = id.slice(id.indexOf(marker) + marker.length).split('?')[0];
  return tail
    .replace(/\.(gts|ts)$/, '')
    .split(sep)
    .join('/');
}

export function bundledBaseScopedCSS() {
  return {
    name: 'bundled-base-scoped-css',
    // After the template compilation that emits the import, and before the
    // bundler resolves it: `enforce: 'post'` puts this at the end of the
    // transform chain.
    enforce: 'post',
    transform(code, id) {
      if (!isBaseModule(id)) {
        return null;
      }
      let specifiers = [...code.matchAll(SCOPED_CSS_IMPORT)].map((m) => m[1]);
      if (!specifiers.length) {
        return null;
      }
      let name = baseModuleName(id);
      let registration =
        `\n;(globalThis.${REGISTRY} ??= {})[${JSON.stringify(name)}] = ` +
        `${JSON.stringify(specifiers)};\n`;
      return { code: code + registration, map: null };
    },
  };
}
