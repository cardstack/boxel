// Fails the build when its output holds a module from anywhere but this
// package and the packages named below. Everything the secure origin serves
// can read every password typed on it, so this list is the origin's trusted
// code from outside the package: adding a package to it is a change to that
// trusted code, and is reviewed as one.
//
// The check reads the bundle, not source imports, so it sees what actually
// ships: a module reached through a dependency's own imports is caught the
// same as one this package imports by name.
import { modulePackage } from './module-package.mjs';

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

// Why a module may not ship, or undefined when it may.
export function refusal(id) {
  let found = modulePackage(id);
  if (found.virtual) {
    return ALLOWED_VIRTUAL_MODULES.has(found.virtual)
      ? undefined
      : `the bundler module ${JSON.stringify(found.virtual)} is not allowed`;
  }
  if (
    TEMPLATE_COMPILER_PACKAGES.has(found.name) ||
    (found.name === 'ember-source' &&
      TEMPLATE_COMPILER.some((pattern) => pattern.test(found.path)))
  ) {
    return `${describe(found)} is Ember's runtime template compiler`;
  }
  if (found.own || ALLOWED_PACKAGES.has(found.name)) {
    return undefined;
  }
  return `${describe(found)} is from a package not in the import allowlist`;
}

function describe({ name, version, path }) {
  return name ? `${name}@${version} ${path}` : path;
}

export function importAllowlist() {
  return {
    name: 'secure-origin-import-allowlist',
    apply: 'build',
    generateBundle(_options, bundle) {
      let refused = [];
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
  };
}
