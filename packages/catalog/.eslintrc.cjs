'use strict';

const {
  NO_COMPILATION_REQUIRED_TS_SELECTORS,
} = require('../../eslint/erasable-syntax-selectors.cjs');

// contents/ files (both .ts card/command modules and .gts Glimmer components)
// always go through the realm/Ember compilation pipeline, so decorators like
// @field, @tracked, and @action are valid here — only the `Decorator` selector
// is lifted. The remaining erasable-syntax guards (enum, `import =`,
// `export =`, runtime namespaces) still apply, for consistency with the rest
// of the repo.
const CONTENTS_RESTRICTED_SYNTAX = [
  'error',
  ...NO_COMPILATION_REQUIRED_TS_SELECTORS.filter(
    (s) => s.selector !== 'Decorator',
  ),
];

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
  ],
};
