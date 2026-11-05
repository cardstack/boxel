// The template compiler names each component's template by its file's
// absolute path, and records where a template's modifiers and helpers sit by
// the same path. That would put the path the package was built from into the
// pages the origin serves, and make the build, and so the build record,
// differ from one checkout to the next. This names them from the package root
// for the package's own modules, as the build record names modules, and from
// the repository's root for every other module.
//
// boxel-icons is read from its own build, which names its templates by the
// path of whichever checkout built it, so in a module from another package
// of this repository a `moduleName` naming a file in the repository's
// `packages/` is cut back to start there, wherever that was. A package
// installed from the registry ships as it was published.
//
// An import specifier keeps its absolute path, which is how the build's
// runtime helpers and an entry document's generated modules are imported. And
// a chunk that still names the checkout fails the build, naming the modules
// that do.
import { join } from 'node:path';

import type { Plugin } from 'vite';

import { modulePackage, PACKAGE_ROOT } from './module-package.ts';

export const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');

const BUILT_MODULE_NAME = /("moduleName"\s*:\s*")\/[^"]*?\/(packages\/[^"]+")/g;

// `source` with each `moduleName` that names a file by an absolute path in a
// repository's `packages/` cut back to start there. The build record hashes
// a file read from another package's build in this form, so its hash is the
// same in every checkout.
export function portableSource(source: string): string {
  return source.replace(BUILT_MODULE_NAME, '$1$2');
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
      // This checkout's paths first, so the package's own modules are named
      // from the package; then whatever names another checkout.
      let portable = code.includes(repoPrefix)
        ? code.replace(id.startsWith(ownPrefix) ? ownPaths : repoPaths, '')
        : code;
      let found = modulePackage(file);
      if (found.virtual === undefined && found.workspace) {
        portable = portableSource(portable);
      }
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
