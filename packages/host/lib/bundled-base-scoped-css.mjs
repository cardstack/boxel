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
//
// Each module also registers the sibling base modules it imports. Only modules
// the loader is actually asked for get served, and one reached from inside an
// already-bundled chunk never is, so a served module has to answer for the
// stylesheets of everything it pulls in as well as its own.
//
// And each registers where the names it re-exports are really declared, so the
// loader credits the declarer rather than the module that borrows them.
import { sep } from 'node:path';

const REGISTRY = '__boxelBundledBaseScopedCSS';

// `<fromFile>.<encoded stylesheet>.glimmer-scoped.css` wherever it appears as
// a string in the compiled module. A stylesheet is imported for its side
// effect, so the import carries no `from` clause to anchor on.
const SCOPED_CSS_IMPORT = /["']([^"']*\.glimmer-scoped\.css)["']/g;

// Relative specifiers, which inside packages/base name sibling base modules.
// Stylesheet specifiers are relative too and are collected separately.
const RELATIVE_IMPORT = /["'](\.\.?\/[^"']*)["']/g;

// `export { X, Y as Z } from './y'`. A module that re-exports a binding does
// not declare it, and the loader credits whichever module it serves first with
// every name that module exposes — so a re-exporter served first takes the
// credit and a code ref then names the wrong module. Recording where each
// borrowed name really comes from lets the re-exporter hand the credit
// straight to the declarer, whatever the serving order and whether or not the
// declarer is ever served on its own.
//
// `export * from './y'` names nothing statically and is not collected; no
// bundled base module uses it.
const REEXPORT_CLAUSE =
  /\bexport\s*\{([^}]*)\}\s*from\s*["'](\.\.?\/[^"']*)["']/g;

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

// `card-api` + `./default-templates/embedded` → `default-templates/embedded`,
// the same key form the importing module was given.
function resolveSibling(fromName, specifier) {
  let segments = fromName.split('/').slice(0, -1);
  for (let part of specifier.split('/')) {
    if (part === '.' || part === '') {
      continue;
    } else if (part === '..') {
      segments.pop();
    } else {
      segments.push(part);
    }
  }
  return segments.join('/').replace(/\.(gts|ts)$/, '');
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
      let name = baseModuleName(id);
      let css = [...code.matchAll(SCOPED_CSS_IMPORT)].map((m) => m[1]);
      // `{ [exposed name]: [declaring module, name it has there] }`.
      let reexported = {};
      for (let match of code.matchAll(REEXPORT_CLAUSE)) {
        let source = resolveSibling(name, match[2]);
        for (let clause of match[1].split(',')) {
          let parts = clause.trim().split(/\s+as\s+/);
          if (!parts[0]) {
            continue;
          }
          // `X as Y` is exposed as Y and declared as X; a bare `X` is both.
          let exposed = (parts[1] ?? parts[0]).trim();
          reexported[exposed] = [source, parts[0].trim()];
        }
      }
      let imports = [
        ...new Set(
          [...code.matchAll(RELATIVE_IMPORT)]
            .map((m) => m[1])
            .filter((specifier) => !specifier.endsWith('.glimmer-scoped.css'))
            .map((specifier) => resolveSibling(name, specifier)),
        ),
      ].filter((imported) => imported !== name);
      if (!css.length && !imports.length && !Object.keys(reexported).length) {
        return null;
      }
      // A name that turns out to be something other than a base module costs
      // nothing: the reader walks only names the registry holds.
      let registration =
        `\n;(globalThis.${REGISTRY} ??= {})[${JSON.stringify(name)}] = ` +
        `${JSON.stringify({ css, imports, reexported })};\n`;
      return { code: code + registration, map: null };
    },
  };
}
