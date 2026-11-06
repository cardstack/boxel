// The template compiler names each component's template by its file's
// absolute path, records where a template's modifiers and helpers sit by the
// same path, and derives each template's `id` from that name. That would put
// the path the package was built from into the pages the origin serves, and
// make the build, and so the build record, differ from one checkout to the
// next. This names them from the package root for the package's own modules,
// as the build record names modules, and from the repository's root for every
// other module. It gives each template an `id` derived from that name instead,
// and from the template's place in its module, so ids stay unique and are the
// same in every checkout.
//
// boxel-icons is read from its own build, which names its templates by the
// path of whichever checkout built it, so in a module from another package
// of this repository a `moduleName` naming a file in the repository's
// `packages/` is cut back to start there, wherever that was. A package
// installed from the registry ships as it was published, but for its
// templates' ids.
//
// An import specifier keeps its absolute path, which is how the build's
// runtime helpers and an entry document's generated modules are imported. And
// a chunk that still names the checkout fails the build, naming the modules
// that do.
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

import type { Plugin } from 'vite';

import { modulePackage, PACKAGE_ROOT } from './module-package.ts';

export const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');

// Cut at the last `/packages/`, so a checkout whose own path has a `packages`
// directory in it is cut where any other checkout's is.
const BUILT_MODULE_NAME = /("moduleName"\s*:\s*")\/[^"]*\/(packages\/[^"]+")/g;

// A compiled template's `id`, which always comes just before its `block`,
// whether the keys are quoted (as the compiler writes them) or not.
const TEMPLATE_ID =
  /((?:"id"|\bid)\s*:\s*)(["'`])[A-Za-z0-9+/=_-]{8}\2(\s*,\s*(?:"block"|\bblock)\s*:)/g;

// `code` with each compiled template's `id` derived from `name`, the module's
// name as the build record gives it, and the template's place in the module.
export function stableTemplateIds(code: string, name: string): string {
  let index = 0;
  return code.replace(TEMPLATE_ID, (_match, key, quote, rest) => {
    let id = createHash('sha256')
      .update(`${name}#${index++}`)
      .digest('base64')
      .slice(0, 8);
    return `${key}${quote}${id}${quote}${rest}`;
  });
}

// `source`, a file read from another package of this repository's build, in
// the form that is the same in every checkout: each `moduleName` that names a
// file by an absolute path in a repository's `packages/` cut back to start
// there, and each template's `id` derived from `name`, as the build ships it.
// The build record hashes such a file in this form.
export function portableSource(source: string, name: string): string {
  return stableTemplateIds(source.replace(BUILT_MODULE_NAME, '$1$2'), name);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Occurrences of `root` that are not an import's specifier.
function pathsIn(root: string): RegExp {
  return new RegExp(
    `(?<!(?:\\bfrom|\\bimport)\\s*\\(?\\s*["'])${escapeRegExp(root)}`,
    'g',
  );
}

export function relativeModuleNames(): Plugin {
  let ownPrefix = `${PACKAGE_ROOT}/`;
  let repoPrefix = `${REPO_ROOT}/`;
  let ownPaths = pathsIn(ownPrefix);
  let repoPaths = pathsIn(repoPrefix);
  return {
    name: 'secure-origin-relative-module-names',
    enforce: 'post',
    transform(code, id) {
      let file = id.split('?')[0];
      // An entry document's generated modules import each other by absolute
      // path, which has to stay as it is.
      if (file.endsWith('.html')) {
        return null;
      }
      let own = id.startsWith(ownPrefix);
      // This checkout's paths first, so the package's own modules are named
      // from the package; then whatever names another checkout.
      let portable = code.includes(repoPrefix)
        ? code.replace(own ? ownPaths : repoPaths, '')
        : code;
      let found = modulePackage(file);
      let name = relative(own ? PACKAGE_ROOT : REPO_ROOT, file);
      portable =
        found.virtual === undefined && found.workspace
          ? portableSource(portable, name)
          : stableTemplateIds(portable, name);
      return portable === code ? null : { code: portable, map: null };
    },
    generateBundle(_options, bundle) {
      let named: string[] = [];
      for (let [fileName, output] of Object.entries(bundle)) {
        if (output.type !== 'chunk') {
          continue;
        }
        for (let [id, info] of Object.entries(output.modules)) {
          if (info.code?.includes(repoPrefix)) {
            named.push(`${fileName}: ${id.replace(repoPrefix, '')}`);
          }
        }
      }
      if (named.length > 0) {
        this.error(
          `The secure origin's build names the checkout it was built in, so its record would differ from one checkout to the next:\n${named
            .map((line) => `  ${line}`)
            .join('\n')}`,
        );
      }
    },
  };
}
