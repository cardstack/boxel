'use strict';

module.exports = {
  overrides: [
    {
      // contents/ .ts files are Boxel card/command modules that go through the
      // realm compilation pipeline — decorators are valid here.
      files: ['contents/**/*.ts'],
      rules: {
        'no-restricted-syntax': 'off',
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
        // .gts files always go through the Ember build pipeline, so decorators
        // like @tracked and @action are valid here — the no-erasable-syntax
        // restriction only applies to Node-native strip-types contexts.
        'no-restricted-syntax': 'off',
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
