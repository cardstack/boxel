'use strict';

// Selectors for TypeScript syntax that Node cannot run via
// `--experimental-strip-types`, which only handles "erasable" TS —
// syntax that vanishes once type annotations are stripped. New code
// must avoid these so it can run under Node natively.
//
// Shared by the root `.eslintrc.js`, `packages/ai-bot/.eslintrc.js`
// (which is `root: true`), and `packages/catalog/.eslintrc.cjs` (which
// lifts only the `Decorator` selector for realm-compiled contents).
const NO_COMPILATION_REQUIRED_TS_SELECTORS = [
  {
    selector: 'TSEnumDeclaration',
    message:
      'TypeScript `enum` is not erasable and requires compilation. Use a `const` object with `as const` (or a union of string literals) instead.',
  },
  {
    selector: 'TSImportEqualsDeclaration',
    message:
      '`import =` syntax requires TypeScript compilation. Use standard ES module `import` instead.',
  },
  {
    selector: 'TSExportAssignment',
    message:
      '`export =` syntax requires TypeScript compilation. Use a standard ES module `export default` (or named exports) instead.',
  },
  {
    selector: 'Decorator',
    message:
      "Decorators are not erasable and require compilation, so they break under Node's native `--experimental-strip-types`. Avoid decorators here (e.g. replace `@Memoize()` with a manual cache).",
  },
  {
    // Non-ambient `namespace`/`module` blocks emit runtime code. Ambient
    // declarations (`declare module`, `declare global`, `declare namespace`)
    // are type-only and erasable, so they are exempt via `:not([declare=true])`.
    selector: 'TSModuleDeclaration:not([declare=true])',
    message:
      'TypeScript `namespace`/`module` blocks emit runtime code and are not erasable. Use standard ES modules instead.',
  },
];

// CommonJS-only globals that are `undefined` when a module is loaded as native
// ESM (`type: module`, or imported as ESM by another tool). `import.meta.dirname`
// / `import.meta.url` are the ESM equivalents. Used with `no-restricted-globals`,
// which flags only true global references — not comments, local bindings, or
// `import.meta.dirname` member access.
//
// Scoped (in the configs that consume this) to `src/` and `scripts/` TS source,
// the surface that runs/imports as ESM. Modules that ONLY ever execute as an
// esbuild CJS bundle (where `__dirname` is real and `import.meta` is a TS1470
// error) are the legitimate exception — opt out per-line with an
// `// eslint-disable-next-line no-restricted-globals` and a reason.
const CJS_GLOBALS_IN_ESM = [
  {
    name: '__dirname',
    message:
      '`__dirname` is undefined when this module is loaded as native ESM. Use `import.meta.dirname` instead. If this module only ever runs as a CJS bundle, opt out with an `eslint-disable-next-line no-restricted-globals` and a reason.',
  },
  {
    name: '__filename',
    message:
      '`__filename` is undefined when this module is loaded as native ESM. Use `import.meta.filename` (or `fileURLToPath(import.meta.url)`) instead. If this module only ever runs as a CJS bundle, opt out with an `eslint-disable-next-line no-restricted-globals` and a reason.',
  },
];

module.exports = { NO_COMPILATION_REQUIRED_TS_SELECTORS, CJS_GLOBALS_IN_ESM };
