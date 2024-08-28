'use strict';

const { resolve } = require('path');

module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  env: {
    browser: true,
  },
  overrides: [
    {
      files: ['**/*.ts'],
      parser: '@typescript-eslint/parser',
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
        project: [resolve(__dirname, './tsconfig.json')],
      },
      plugins: ['ember', '@typescript-eslint', 'window-mock'],
      extends: [
        'eslint:recommended',
        'plugin:ember/recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:prettier/recommended',
        'plugin:qunit-dom/recommended',
      ],
      rules: {
        '@typescript-eslint/no-empty-function': 'off',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        'prefer-const': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/ban-types': 'off',
        '@typescript-eslint/ban-ts-comment': 'off',
        '@typescript-eslint/explicit-module-boundary-types': 'off',
        '@typescript-eslint/no-this-alias': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/await-thenable': 'error',
        'no-undef': 'off',
        'ember/no-runloop': 'off',
        'window-mock/mock-window-only': 'error',
      },
    },
    {
      files: ['**/*.gts'],
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
      plugins: ['ember', 'window-mock'],
      extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:ember/recommended',
        'plugin:ember/recommended-gts',
        'plugin:prettier/recommended',
        'plugin:qunit-dom/recommended',
      ],
      rules: {
        '@typescript-eslint/no-empty-function': 'off',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        'prefer-const': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/ban-types': 'off',
        '@typescript-eslint/ban-ts-comment': 'off',
        '@typescript-eslint/explicit-module-boundary-types': 'off',
        '@typescript-eslint/no-this-alias': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        'no-undef': 'off',
        'ember/template-no-let-reference': 'off',
        'ember/no-tracked-properties-from-args': 'off',
        'ember/no-runloop': 'off',
        'node/no-deprecated-api': 'off',
        'deprecation/deprecation': 'off',
        'window-mock/mock-window-only': 'error',
      },
    },
    // node files
    {
      files: [
        './.eslintrc.js',
        './.percy.js',
        './.prettierrc.js',
        './.stylelintrc.js',
        './.template-lintrc.js',
        './ember-cli-build.js',
        './testem.js',
        './blueprints/*/index.js',
        './config/**/*.js',
        './lib/**/*.js',
        './server/**/*.js',
      ],
      parserOptions: {
        sourceType: 'script',
      },
      env: {
        browser: false,
        node: true,
      },
      extends: ['plugin:n/recommended'],
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
    {
      // test files
      files: ['tests/**/*-test.{js,ts}'],
      extends: ['plugin:qunit/recommended'],
      rules: {
        'qunit/require-expect': 'off',
        'qunit/no-conditional-assertions': 'off',
      },
    },
    {
      // don’t enforce import order on blueprint files
      files: ['app/**', 'tests/**'],
      excludedFiles: ['app/app.ts', 'app/router.ts', 'tests/test-helper.js'],
      extends: ['plugin:import/recommended', 'plugin:import/typescript'],
      rules: {
        // sufficiently covered by eslint no-duplicate-imports
        'import/no-duplicates': 'off',
        // this doesn't work well with the monorepo. Typescript already complains if you try to import something that's not found
        'import/no-unresolved': 'off',
        'import/order': [
          'error',
          {
            'newlines-between': 'always-and-inside-groups',
            alphabetize: {
              order: 'asc',
            },
            groups: [
              'builtin',
              'external',
              'internal',
              'parent',
              'sibling',
              'index',
              'object',
              'type',
            ],
            pathGroups: [
              {
                pattern: '@ember/**',
                group: 'builtin',
              },
              {
                pattern: '@embroider/**',
                group: 'builtin',
              },
              {
                pattern: '@glimmer/**',
                group: 'builtin',
              },
              {
                pattern: '@cardstack/boxel-ui{*,/**}',
                group: 'internal',
                position: 'before',
              },
              {
                pattern: '@cardstack/runtime-common{*,/**}',
                group: 'internal',
                position: 'before',
              },
              {
                pattern: '@cardstack/host/**',
                group: 'internal',
                position: 'after',
              },
              {
                pattern: '@cardstack**',
                group: 'internal',
              },
              {
                pattern: 'https://cardstack.com/**',
                group: 'internal',
                position: 'after',
              },
            ],
            pathGroupsExcludedImportTypes: [],
          },
        ],
      },
    },
  ],
};
