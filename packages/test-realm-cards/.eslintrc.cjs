'use strict';

// This realm's source is type-checked by the host package's `lint:types`, and
// ESLint runs here for one thing: a base-realm module is imported by its
// `@cardstack/base/` prefix, never the `https://cardstack.com/base/` alias.
// `.ts` is linted alongside `.gts` so that a TypeScript module added to the
// realm is held to the same rule. The config is `root` so the repository's style
// rules stay out of a fixture realm that has never been formatted to them. The
// realm's JSON is checked by the `lint:card-json` script.
module.exports = {
  root: true,
  plugins: ['@cardstack/boxel'],
  overrides: [
    {
      files: ['**/*.ts'],
      parser: '@typescript-eslint/parser',
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
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
    },
    {
      files: ['**/*.ts', '**/*.gts'],
      rules: {
        '@cardstack/boxel/no-url-form-base-imports': 'error',
      },
    },
  ],
};
