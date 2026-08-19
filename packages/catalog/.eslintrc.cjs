'use strict';

const {
  NO_COMPILATION_REQUIRED_TS_SELECTORS,
} = require('../../eslint/erasable-syntax-selectors.cjs');
const { DATA_TEST_SELECTORS } = require('../../eslint/data-test-selectors.cjs');

// contents/ files (both .ts card/command modules and .gts Glimmer components)
// always go through the realm/Ember compilation pipeline, so decorators like
// @field, @tracked, and @action are valid here — only the `Decorator` selector
// is lifted. The remaining erasable-syntax guards (enum, `import =`,
// `export =`, runtime namespaces) still apply, for consistency with the rest
// of the repo.
const ERASABLE_MINUS_DECORATOR = NO_COMPILATION_REQUIRED_TS_SELECTORS.filter(
  (s) => s.selector !== 'Decorator',
);

// `data-test-*` is a test-only hook. Unlike host app builds, the realm card
// pipeline (runtime-common) does NOT strip these attributes, so card selectors
// on them survive to production — but coupling styling/behavior to a test hook
// is fragile (deleting a test selector silently changes production), so it is
// banned in card content too. Tests legitimately select on them, so the
// data-test ban is dropped for test files (see CONTENTS_TEST_RESTRICTED_SYNTAX).
const CONTENTS_RESTRICTED_SYNTAX = [
  'error',
  ...ERASABLE_MINUS_DECORATOR,
  ...DATA_TEST_SELECTORS,
];
const CONTENTS_TEST_RESTRICTED_SYNTAX = ['error', ...ERASABLE_MINUS_DECORATOR];

module.exports = {
  overrides: [
    {
      files: ['contents/**/*.ts'],
      rules: {
        'no-restricted-syntax': CONTENTS_RESTRICTED_SYNTAX,
      },
    },
    {
      files: ['contents/**/*.gts'],
      parser: 'ember-eslint-parser',
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        requireConfigFile: false,
        babelOptions: {
          plugins: [
            [
              '@babel/plugin-proposal-decorators',
              { decoratorsBeforeExport: true },
            ],
          ],
        },
        warnOnUnsupportedTypeScriptVersion: false,
      },
      extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:ember/recommended',
        'plugin:ember/recommended-gts',
        'plugin:prettier/recommended',
      ],
      rules: {
        'no-restricted-syntax': CONTENTS_RESTRICTED_SYNTAX,
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/ban-ts-comment': 'off',
        '@typescript-eslint/ban-types': 'off',
        '@typescript-eslint/consistent-type-imports': 'off',
        '@typescript-eslint/no-import-type-side-effects': 'off',
        'ember/no-empty-glimmer-component-classes': 'off',
        'ember/no-test-support-import': 'off',
        'getter-return': 'off',
        'no-undef': 'off',
      },
    },
    {
      // Tests legitimately select on `data-test-*` (e.g.
      // `assert.dom('[data-test-foo]')`); keep the erasable-syntax guards but
      // drop the data-test ban. This override only resets `no-restricted-syntax`
      // — the parser/extends from the `contents/**/*.gts` override above still
      // apply to `.gts` tests.
      files: [
        'contents/**/*.test.{js,ts,gts,gjs}',
        'contents/**/*-test.{js,ts,gts,gjs}',
        'contents/tests/**',
      ],
      rules: {
        'no-restricted-syntax': CONTENTS_TEST_RESTRICTED_SYNTAX,
      },
    },
  ],
};
