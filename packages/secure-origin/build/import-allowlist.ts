// Fails the build when its output holds a module from anywhere but this
// package and the packages named below. Everything the secure origin serves
// can read every password typed on it, so this list is the origin's trusted
// code from outside the package: adding a package to it is a change to that
// trusted code, and is reviewed as one.
//
// The check reads the bundle, not source imports, so it sees what actually
// ships: a module reached through a dependency's own imports is caught the
// same as one this package imports by name.
//
// A stylesheet's `@import` and `url()` are followed by the CSS pipeline, which
// inlines what they name into the stylesheet rather than adding a module to
// the bundle. So the package's stylesheets may not `@import` at all, and a
// `url()` may name only a file inside the package, or a relative path the
// origin itself serves at run time (boxel-ui's typeface, beside the
// stylesheet).
import { dirname, isAbsolute, join, relative } from 'node:path';

import type { Plugin } from 'vite';

import {
  modulePackage,
  type ModulePackage,
  PACKAGE_ROOT,
} from './module-package.ts';

export const ALLOWED_PACKAGES = new Set([
  'ember-source',
  '@glimmer/component',
  '@glimmer/tracking',
  // The build's runtime helpers, which compiled code calls into.
  '@babel/runtime',
  'decorator-transforms',
]);

// Modules the bundler itself generates, which have no file on disk.
export const ALLOWED_VIRTUAL_MODULES = new Set([
  '\0rolldown/runtime.js',
  '\0vite/preload-helper.js',
]);

// Ember's runtime template compiler. Templates are compiled at build time, so
// nothing in the output needs it, and it is what would make a page need
// `unsafe-eval`.
const TEMPLATE_COMPILER = [
  /(^|\/)ember-template-compiler(\.js|\/)/,
  /(^|\/)@ember\/template-compiler(\/|$)/,
  /(^|\/)@glimmer\/compiler(\/|$)/,
  /(^|\/)@glimmer\/syntax(\/|$)/,
];
const TEMPLATE_COMPILER_PACKAGES = new Set([
  '@ember/template-compiler',
  '@glimmer/compiler',
  '@glimmer/syntax',
  'ember-template-compiler',
]);

const CSS_IMPORT = /@import\b/;
const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

// Why a module may not ship, or undefined when it may.
export function refusal(id: string): string | undefined {
  let found = modulePackage(id);
  if (found.virtual !== undefined) {
    return ALLOWED_VIRTUAL_MODULES.has(found.virtual)
      ? undefined
      : `the bundler module ${JSON.stringify(found.virtual)} is not allowed`;
  }
  if (
    (found.name && TEMPLATE_COMPILER_PACKAGES.has(found.name)) ||
    (found.name === 'ember-source' &&
      TEMPLATE_COMPILER.some((pattern) => pattern.test(found.path)))
  ) {
    return `${describe(found)} is Ember's runtime template compiler`;
  }
  if (found.own || (found.name && ALLOWED_PACKAGES.has(found.name))) {
    return undefined;
  }
  return `${describe(found)} is from a package not in the import allowlist`;
}

// Why a stylesheet of the package's may not be built, or undefined when it
// may.
export function stylesheetRefusal(
  id: string,
  source: string,
): string | undefined {
  if (CSS_IMPORT.test(source)) {
    return `${relative(PACKAGE_ROOT, id)} uses @import, which would inline a stylesheet the allowlist can't see`;
  }
  for (let [, , url] of source.matchAll(CSS_URL)) {
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(url) || isAbsolute(url)) {
      return `${relative(PACKAGE_ROOT, id)} names ${url}, which is not a relative path`;
    }
    let target = relative(PACKAGE_ROOT, join(dirname(id), url));
    if (target.startsWith('..') || isAbsolute(target)) {
      return `${relative(PACKAGE_ROOT, id)} names ${url}, which is outside the package`;
    }
  }
  return undefined;
}

function describe(found: Exclude<ModulePackage, { virtual: string }>): string {
  return found.name
    ? `${found.name}@${found.version} ${found.path}`
    : found.path;
}

export function importAllowlist(): Plugin[] {
  return [
    {
      name: 'secure-origin-stylesheet-allowlist',
      apply: 'build',
      enforce: 'pre',
      transform(source, id) {
        let file = id.split('?')[0];
        if (!file.endsWith('.css')) {
          return null;
        }
        let reason = modulePackage(file).virtual
          ? `the bundler stylesheet ${JSON.stringify(id)} is not allowed`
          : (refusal(file) ?? stylesheetRefusal(file, source));
        if (reason) {
          this.error(`The secure origin's build may not ship: ${reason}`);
        }
        return null;
      },
    },
    {
      name: 'secure-origin-import-allowlist',
      apply: 'build',
      generateBundle(_options, bundle) {
        let refused: string[] = [];
        for (let [fileName, output] of Object.entries(bundle)) {
          if (output.type !== 'chunk') {
            continue;
          }
          for (let id of Object.keys(output.modules)) {
            let reason = refusal(id);
            if (reason) {
              refused.push(`${fileName}: ${reason}`);
            }
          }
        }
        if (refused.length > 0) {
          this.error(
            `The secure origin's build holds modules it may not ship:\n${refused
              .map((line) => `  ${line}`)
              .join('\n')}`,
          );
        }
      },
    },
  ];
}
