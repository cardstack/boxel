/**
 * Debugging:
 *   https://eslint.org/docs/latest/use/configure/debug
 *  ----------------------------------------------------
 *
 *   Print a file's calculated configuration
 *
 *     npx eslint --print-config path/to/file.js
 *
 *   Inspecting the config
 *
 *     npx eslint --inspect-config
 *
 */
import { createRequire } from 'node:module';

import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import ember from 'eslint-plugin-ember/recommended';
import importPlugin from 'eslint-plugin-import';
import n from 'eslint-plugin-n';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import typescriptSortKeys from 'eslint-plugin-typescript-sort-keys';
import globals from 'globals';
import ts from 'typescript-eslint';

const require = createRequire(import.meta.url);
// CJS modules shared with the eslintrc-based packages in this monorepo
const boxel = require('@cardstack/eslint-plugin-boxel');
const MISSING_INVOKABLES_CONFIG = require('../../runtime-common/etc/eslint/missing-invokables-config');
const {
  DATA_TEST_SELECTORS,
} = require('../../../eslint/data-test-selectors.cjs');

const esmParserOptions = {
  ecmaFeatures: { modules: true },
  ecmaVersion: 'latest',
};

export default defineConfig([
  globalIgnores([
    'dist/',
    'dist-*/',
    'declarations/',
    'coverage/',
    'blueprints/*/files/',
    '!**/.*',
  ]),
  js.configs.recommended,
  prettier,
  ember.configs.base,
  ember.configs.gjs,
  ember.configs.gts,
  /**
   * https://eslint.org/docs/latest/use/configure/configuration-files#configuring-linter-options
   */
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  {
    files: ['**/*.{js,gjs}'],
    languageOptions: {
      parserOptions: esmParserOptions,
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: ['**/*.{ts,gts}'],
    languageOptions: {
      parser: ember.parser,
      globals: {
        ...globals.browser,
      },
    },
    extends: [
      // The repo is not on type-aware linting (recommendedTypeChecked)
      // anywhere yet; keep this package at the same strictness as the rest.
      ...ts.configs.recommended,
      ember.configs.gts,
    ],
  },
  {
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      curly: 'error',
      'prefer-const': 'off',
      'simple-import-sort/exports': 'error',
      'simple-import-sort/imports': 'error',
    },
  },
  {
    files: ['**/*.{ts,gts}'],
    plugins: {
      'typescript-sort-keys': typescriptSortKeys,
    },
    rules: {
      'typescript-sort-keys/interface': 'error',
      'typescript-sort-keys/string-enum': 'error',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // typescript-eslint recommends turning off no-undef for Typescript files
    // since Typescript will better analyse that:
    // https://github.com/typescript-eslint/typescript-eslint/blob/5b0e577f2552e8b2c53a3fb22edc9d219589b937/docs/linting/Troubleshooting.mdx#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
    files: ['**/*.{ts,gts}'],
    rules: {
      'no-undef': 'off',
    },
  },
  {
    // Disallow `data-test-*` CSS/DOM selectors in source code.
    // ember-test-selectors strips these attributes in production, so
    // selectors like `querySelector('[data-test-foo]')` silently break
    // outside of tests. Scoped to source only — tests legitimately select
    // on `data-test-*`.
    files: ['src/**/*.{js,ts,gts,gjs}'],
    rules: {
      'no-restricted-syntax': ['error', ...DATA_TEST_SELECTORS],
    },
  },
  {
    files: ['src/**/*'],
    plugins: {
      import: importPlugin,
    },
    rules: {
      // require relative imports use full extensions
      'import/extensions': ['error', 'always', { ignorePackages: true }],
    },
  },
  {
    files: ['**/*.{gts,gjs}'],
    plugins: {
      '@cardstack/boxel': boxel,
    },
    rules: {
      ...boxel.configs.recommended.rules,
      '@cardstack/boxel/template-missing-invokable': [
        'error',
        { invokables: MISSING_INVOKABLES_CONFIG.invokables },
      ],
      '@cardstack/boxel/no-raf-for-state': 'error',
      'ember/no-runloop': 'off',
      'ember/no-tracked-properties-from-args': 'off',
      'ember/template-no-let-reference': 'off',
    },
  },
  /**
   * CJS node files
   */
  {
    files: ['**/*.cjs', '.template-lintrc.js'],
    plugins: {
      n,
    },

    languageOptions: {
      sourceType: 'script',
      ecmaVersion: 'latest',
      globals: {
        ...globals.node,
      },
    },
  },
  /**
   * ESM node files
   */
  {
    files: ['**/*.mjs', 'bin/**/*.mjs'],
    plugins: {
      n,
    },

    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 'latest',
      parserOptions: esmParserOptions,
      globals: {
        ...globals.node,
      },
    },
  },
]);
