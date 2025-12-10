'use strict';

const MISSING_INVOKABLES_CONFIG = require('../runtime-common/etc/eslint/missing-invokables-config');

// Applies to all of JS, TS, GJS, and GTS in the browser context.
const sharedBrowserConfig = {
  plugins: [
    'ember',
    '@typescript-eslint',
    'cardstack-host',
    '@cardstack/boxel',
  ],
  extends: [
    'eslint:recommended',
    'plugin:ember/recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:ember/recommended-gts',
    'plugin:prettier/recommended',
    'plugin:qunit-dom/recommended',
    'plugin:@cardstack/boxel/recommended',
  ],
  rules: {
    '@typescript-eslint/consistent-type-imports': [
      'error',
      {
        disallowTypeAnnotations: false,
      },
    ],
    '@typescript-eslint/no-import-type-side-effects': 'error',
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
    'ember/no-runloop': 'off',
    'cardstack-host/mock-window-only': 'error',
    'cardstack-host/wrapped-setup-helpers-only': 'error',
    'cardstack-host/host-commands-registered': 'error',
    'ember/template-no-let-reference': 'off',
    'ember/no-tracked-properties-from-args': 'off',
    'node/no-deprecated-api': 'off',
    '@cardstack/boxel/template-missing-invokable': [
      'error',
      { invokables: MISSING_INVOKABLES_CONFIG.invokables },
    ],
  },
};

module.exports = {
  root: true,
  env: {
    browser: true,
  },
  overrides: [
    {
      files: ['**/*.{js,ts}'],
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
        warnOnUnsupportedTypeScriptVersion: false,
      },
      ...sharedBrowserConfig,
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
      ...sharedBrowserConfig,
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
        './vite.config.mjs',
        './babel.config.cjs',
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
      files: ['tests/**/*-test.{gjs,gts,js,ts}'],
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
