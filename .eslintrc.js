'use strict';

const {
  NO_COMPILATION_REQUIRED_TS_SELECTORS,
  CJS_GLOBALS_IN_ESM,
} = require('./eslint/erasable-syntax-selectors.cjs');

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
    // Keep new code "erasable" so Node can run it via
    // `--experimental-strip-types` (type-only syntax that vanishes when stripped).
    '@typescript-eslint/parameter-properties': [
      'error',
      { prefer: 'class-property' },
    ],
    'no-restricted-syntax': ['error', ...NO_COMPILATION_REQUIRED_TS_SELECTORS],
  },
  overrides: [
    {
      // Scoped to the root file only (`./`), so it does not cascade to
      // package-level configs.
      files: ['./.eslintrc.js'],
      parserOptions: {
        sourceType: 'script',
      },
      env: {
        node: true,
      },
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
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
    {
      // Ban the CommonJS-only `__dirname`/`__filename` globals in TS source under
      // `src/` and `scripts/` — the surface that runs or gets imported as native
      // ESM, where they are `undefined`. Bundle-only modules opt out per-line.
      // Packages with their own `root: true` ESLint config don't inherit this and
      // must re-declare it; among the native-ESM (`type: module`) packages only
      // `ai-bot` is `root: true`, and it does (see its `.eslintrc.cjs`).
      files: ['**/src/**/*.{ts,mts}', '**/scripts/**/*.{ts,mts}'],
      rules: {
        'no-restricted-globals': ['error', ...CJS_GLOBALS_IN_ESM],
      },
    },
  ],
};
