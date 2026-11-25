import { defineConfig, globalIgnores } from 'eslint/config';

import {
  NODE_GLOBALS,
  ember,
  globals,
  qunitTests,
  rootConfig,
} from '../../eslint/shared.mjs';

export default defineConfig([
  globalIgnores(['dist/', 'dist-lint/', 'dist-tests/']),
  ...rootConfig('secure-origin'),
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2021 },
    },
  },
  {
    // `plugin:ember/recommended-gts`: the parser, and the one rule it adds.
    files: ['**/*.gts'],
    plugins: { ember: ember.plugin },
    languageOptions: { parser: ember.parser },
    processor: 'ember/noop',
    rules: { 'ember/template-no-let-reference': 'error' },
  },
  {
    ...NODE_GLOBALS,
    files: ['build/**/*.ts', 'tests/**/*.test.ts', 'vite.config.ts', '*.cjs'],
  },
  {
    // The components' suite, run in the browser.
    ...qunitTests(['tests/**/*-test.{ts,gts}']),
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
    files: ['src/security/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@ember/*',
                '@glimmer/*',
                'ember-*',
                'ember',
                '@cardstack/*',
                'glimmer-motion',
                'glimmer-motion/*',
              ],
              message:
                'src/security/ imports nothing from Ember, Glimmer, Pret UI, boxel-icons or any other component package: components call these modules, not the other way round.',
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
    files: ['src/telemetry/**'],
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
]);
