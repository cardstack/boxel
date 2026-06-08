'use strict';

// Selectors for TypeScript syntax that Node cannot run via
// `--experimental-strip-types`, which only handles "erasable" TS —
// syntax that vanishes once type annotations are stripped. New code
// must avoid these so it can run under Node natively, without ts-node.
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

const DATA_TEST_SELECTORS = [
  {
    selector: 'Literal[value=/\\[data-test-/]',
    message:
      '`data-test-*` attributes are stripped in production builds. Use a plain `data-*` attribute (e.g. `[data-foo]`) for functional selectors.',
  },
  {
    selector: 'TemplateElement[value.raw=/\\[data-test-/]',
    message:
      '`data-test-*` attributes are stripped in production builds. Use a plain `data-*` attribute (e.g. `[data-foo]`) for functional selectors.',
  },
];

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    ecmaFeatures: {
      legacyDecorators: true,
    },
  },
  plugins: ['ember'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  rules: {
    '@typescript-eslint/consistent-type-imports': [
      'error',
      {
        disallowTypeAnnotations: false,
      },
    ],
    '@typescript-eslint/no-import-type-side-effects': 'error',
    // this doesn't work well with the monorepo. Typescript already complains if you try to import something that's not found
    'import/no-unresolved': 'off',
    'prefer-const': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    '@typescript-eslint/ban-types': 'off',
    '@typescript-eslint/prefer-as-const': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    // Keep new code "erasable" so it can run under Node's
    // `--experimental-strip-types` without ts-node.
    '@typescript-eslint/parameter-properties': [
      'error',
      { prefer: 'class-property' },
    ],
    'no-restricted-syntax': ['error', ...NO_COMPILATION_REQUIRED_TS_SELECTORS],
  },
  overrides: [
    {
      // Disallow data-test-* CSS selectors in app code across all packages.
      // ember-test-selectors strips these attributes in production, so selectors
      // like querySelector('[data-test-foo]') silently break outside of tests.
      files: ['**/app/**/*.{js,ts,gts,gjs}', '**/src/**/*.{js,ts,gts,gjs}'],
      rules: {
        'no-restricted-syntax': [
          'error',
          ...NO_COMPILATION_REQUIRED_TS_SELECTORS,
          ...DATA_TEST_SELECTORS,
        ],
      },
    },
  ],
};
