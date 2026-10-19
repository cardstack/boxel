'use strict';

// This realm's source is checked by glint and ember-template-lint, and ESLint
// runs here for one thing: a base-realm module is imported by its
// `@cardstack/base/` prefix, never the `https://cardstack.com/base/` alias. The
// config is `root` so the repository's style rules stay out of a realm that
// has never been formatted to them.
//
// The `@typescript-eslint` and `import` plugins are loaded, with no rules of
// theirs turned on, so the inline disables that name their rules still resolve.
module.exports = {
  root: true,
  // Format fixtures, served byte-for-byte as sample file content rather than
  // loaded as modules.
  ignorePatterns: ['filedef-fixtures/samples/'],
  plugins: ['@cardstack/boxel', '@typescript-eslint', 'import'],
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
