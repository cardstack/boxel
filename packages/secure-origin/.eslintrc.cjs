'use strict';

module.exports = {
  env: { browser: true, es2022: true },
  overrides: [
    {
      files: ['**/*.gts'],
      parser: 'ember-eslint-parser',
      plugins: ['ember'],
      extends: ['plugin:ember/recommended-gts'],
    },
    {
      files: ['./.eslintrc.cjs', './.template-lintrc.cjs'],
      parserOptions: { sourceType: 'script' },
      env: { browser: false, node: true },
    },
    {
      files: ['./build/**/*.ts', './tests/**/*.test.ts', './vite.config.ts'],
      env: { browser: false, node: true },
    },
    {
      // The components' suite, run in the browser.
      files: ['./tests/**/*-test.{ts,gts}'],
      extends: ['plugin:qunit/recommended'],
      rules: {
        'qunit/require-expect': 'off',
      },
    },
    {
      // The secure origin's security logic: the credential frame's protocol
      // and forms, the Matrix requests, session handling, origin matching and
      // response redaction. It is what a reviewer of the origin reads most
      // closely, so it stays plain modules, readable without the framework
      // and testable without rendering.
      files: ['./src/security/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@ember/*', '@glimmer/*', 'ember-*', 'ember'],
                message:
                  'src/security/ imports nothing from Ember or Glimmer: components call these modules, not the other way round.',
              },
              {
                group: ['../*', '!../security/*'],
                message:
                  'src/security/ imports only other security modules, never the components or pages that call it.',
              },
            ],
          },
        ],
      },
    },
    {
      // The telemetry instrument: plain modules too, so what it records, and
      // that it can't record a secret, is read and tested without rendering.
      files: ['./src/telemetry/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@ember/*', '@glimmer/*', 'ember-*', 'ember'],
                message:
                  'src/telemetry/ imports nothing from Ember or Glimmer: the shell reports to it, not the other way round.',
              },
              {
                group: [
                  '../*',
                  '!../security',
                  '!../security/**',
                  '!../telemetry',
                  '!../telemetry/**',
                ],
                message:
                  'src/telemetry/ imports only telemetry and security modules, never the components or pages that report to it.',
              },
            ],
          },
        ],
      },
    },
  ],
};
