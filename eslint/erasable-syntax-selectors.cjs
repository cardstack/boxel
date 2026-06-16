'use strict';

// Selectors for TypeScript syntax that Node cannot run via
// `--experimental-strip-types`, which only handles "erasable" TS —
// syntax that vanishes once type annotations are stripped. New code
// must avoid these so it can run under Node natively, without ts-node.
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

module.exports = { NO_COMPILATION_REQUIRED_TS_SELECTORS };
