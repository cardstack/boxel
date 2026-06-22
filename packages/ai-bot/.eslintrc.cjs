'use strict';

// `root: true` here, so the root config does not apply and the
// erasable-syntax rule must be re-declared from the shared list.
const {
  NO_COMPILATION_REQUIRED_TS_SELECTORS,
  CJS_GLOBALS_IN_ESM,
} = require('../../eslint/erasable-syntax-selectors.cjs');

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
      files: ['./.eslintrc.js'],
      parserOptions: {
        sourceType: 'script',
      },
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
    {
      // See the root `.eslintrc.js`: ban CommonJS-only `__dirname`/`__filename`
      // in ESM-loaded TS source. Re-declared here because this config is `root`.
      files: ['**/src/**/*.{ts,mts}', '**/scripts/**/*.{ts,mts}'],
      rules: {
        'no-restricted-globals': ['error', ...CJS_GLOBALS_IN_ESM],
      },
    },
  ],
};
