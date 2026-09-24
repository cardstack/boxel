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
import { sep } from 'node:path';

const REGISTRY = '__boxelBundledBaseScopedCSS';

// `<fromFile>.<encoded stylesheet>.glimmer-scoped.css` wherever it appears as
// a string in the compiled module. A stylesheet is imported for its side
// effect, so the import carries no `from` clause to anchor on.
const SCOPED_CSS_IMPORT = /["']([^"']*\.glimmer-scoped\.css)["']/g;

// Relative specifiers, which inside packages/base name sibling base modules.
// Stylesheet specifiers are relative too and are collected separately.
const RELATIVE_IMPORT = /["'](\.\.?\/[^"']*)["']/g;

// Both patterns below match a quoted string anywhere in the module, and a
// module's own comments are full of prose that looks like one — a code ref
// written out in a doc comment reads as an import of a module that need not
// even exist. Scan the code with its comments blanked so a specifier has to be
// something the module actually evaluates.
//
// Read rather than matched: a comment is not a regular language. `/*` appears
// inside line comments here (`@cardstack/boxel-host/lib/*` is written in one),
// and a pattern that takes it for the start of a block comment blanks
// everything to the next `*/` — thousands of characters away, taking real
// imports with it. `//` appears inside strings for the same reason. Only a
// reader that knows which of the three it is in can tell them apart.
//
// Blanked rather than removed, so every offset in the scanned text still lines
// up with the real source.
function withoutComments(code) {
  let out = '';
  let i = 0;
  while (i < code.length) {
    let c = code[i];
    let next = code[i + 1];
    if (c === '/' && next === '/') {
      while (i < code.length && code[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (c === '/' && next === '*') {
      let close = code.indexOf('*/', i + 2);
      let stop = close === -1 ? code.length : close + 2;
      for (; i < stop; i++) {
        out += code[i] === '\n' ? '\n' : ' ';
      }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let quote = c;
      out += c;
      i++;
      while (i < code.length) {
        if (code[i] === '\\') {
          out += code.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += code[i];
        if (code[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

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
      let scannable = withoutComments(code);
      let css = [...scannable.matchAll(SCOPED_CSS_IMPORT)].map((m) => m[1]);
      let imports = [
        ...new Set(
          [...scannable.matchAll(RELATIVE_IMPORT)]
            .map((m) => m[1])
            .filter((specifier) => !specifier.endsWith('.glimmer-scoped.css'))
            .map((specifier) => resolveSibling(name, specifier)),
        ),
      ].filter((imported) => imported !== name);
      if (!css.length && !imports.length) {
        return null;
      }
      // A name that turns out to be something other than a base module costs
      // nothing: the reader walks only names the registry holds.
      let registration =
        `\n;(globalThis.${REGISTRY} ??= {})[${JSON.stringify(name)}] = ` +
        `${JSON.stringify({ css, imports })};\n`;
      return { code: code + registration, map: null };
    },
  };
}
