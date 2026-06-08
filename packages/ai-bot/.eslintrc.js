'use strict';

// See the root `.eslintrc.js` — these selectors guard against TypeScript
// syntax that requires compilation (so it would not work under Node's
// native `--experimental-strip-types`). This package has `root: true`,
// so the root config does not apply here.
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

module.exports = {
  root: true,
  env: {
    node: true,
  },
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
    '@typescript-eslint/parameter-properties': [
      'error',
      { prefer: 'class-property' },
    ],
    'no-restricted-syntax': ['error', ...NO_COMPILATION_REQUIRED_TS_SELECTORS],
  },
  overrides: [
    {
      // Files exempted from the erasable-TypeScript rules because they use
      // TypeScript constructor parameter properties, which are not erasable.
      // Do not add new files here; refactor a file to declare its fields
      // explicitly to remove its entry.
      files: [
        'lib/matrix/response-event-data.ts',
        'lib/matrix/response-publisher.ts',
      ],
      rules: {
        '@typescript-eslint/parameter-properties': 'off',
      },
    },
  ],
};
