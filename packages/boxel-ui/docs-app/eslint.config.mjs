import { createRequire } from 'node:module';

import { defineConfig, globalIgnores } from 'eslint/config';

import {
  DATA_TEST_SELECTORS,
  ESLINT_10_RECOMMENDED_OFF,
  QUNIT_DOM_RECOMMENDED,
  TYPE_IMPORT_RULES,
  boxel,
  ember,
  globals,
  gtsBlock,
  js,
  n,
  prettierRecommended,
  qunitRecommended,
  ts,
} from '../../../eslint/shared.mjs';

const require = createRequire(import.meta.url);
const MISSING_INVOKABLES_CONFIG = require('../../runtime-common/etc/eslint/missing-invokables-config');

const withoutFiles = ({ files: _files, ...config }) => config;

const NO_UNUSED_VARS = [
  'error',
  {
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    caughtErrors: 'none',
  },
];

export default defineConfig([
  globalIgnores([
    'blueprints/*/files/',
    'dist/',
    'coverage/',
    // Dot-directories, but not dotfiles: this package lints its dotfiles.
    '**/.*/',
  ]),
  js.configs.recommended,
  ESLINT_10_RECOMMENDED_OFF,
  ...ts.configs.recommended,
  prettierRecommended,
  withoutFiles(ember.configs.base),
  {
    languageOptions: {
      parser: ts.parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          plugins: [
            [
              '@babel/plugin-proposal-decorators',
              { decoratorsBeforeExport: true },
            ],
          ],
        },
      },
      globals: globals.browser,
    },
    rules: {
      ...TYPE_IMPORT_RULES,
      'prefer-const': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': NO_UNUSED_VARS,
    },
  },
  {
    // Disallow `data-test-*` CSS/DOM selectors in app code. ember-test-selectors
    // strips these attributes in production, so selectors like
    // `querySelector('[data-test-foo]')` silently break outside of tests.
    // Scoped to app code only — tests legitimately select on `data-test-*`.
    files: ['app/**/*.{js,ts,gts,gjs}'],
    rules: {
      'no-restricted-syntax': ['error', ...DATA_TEST_SELECTORS],
    },
  },
  gtsBlock({
    extraExtends: [QUNIT_DOM_RECOMMENDED, boxel.configs.recommended],
    rules: {
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-unused-vars': NO_UNUSED_VARS,
      'prefer-const': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      // `{}` and `Function` are used deliberately, mostly in type plumbing.
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-wrapper-object-types': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-undef': 'off',
      'ember/template-no-let-reference': 'off',
      'ember/no-tracked-properties-from-args': 'off',
      'ember/no-runloop': 'off',
      'node/no-deprecated-api': 'off',
      '@cardstack/boxel/template-missing-invokable': [
        'error',
        { invokables: MISSING_INVOKABLES_CONFIG.boxelUiInvokables },
      ],
    },
  }),
  // node files
  {
    files: [
      '.prettierrc.js',
      '.template-lintrc.js',
      'ember-cli-build.js',
      'index.js',
      'testem.js',
      'blueprints/*/index.js',
      'config/**/*.js',
      'tests/dummy/config/**/*.js',
    ],
    extends: [n.configs['flat/recommended-script']],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      'n/no-unpublished-require': 'off',
      // Successor to the rule above.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // test files
    files: ['tests/**/*-test.{js,ts,gts}'],
    extends: [qunitRecommended],
  },
  {
    // typescript-eslint recommends turning off no-undef for Typescript files since
    // Typescript will better analyse that:
    // https://github.com/typescript-eslint/typescript-eslint/blob/5b0e577f2552e8b2c53a3fb22edc9d219589b937/docs/linting/Troubleshooting.mdx#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
    files: ['**/*.ts', '**/*.gts'],
    rules: {
      'no-undef': 'off',
    },
  },
]);
