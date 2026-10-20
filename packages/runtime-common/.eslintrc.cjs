'use strict';

// Type-aware linting, scoped to this package.
//
// `no-url-from-realm-identifier` asks whether a value carries one of the
// realm-identifier brands. Those exist only in the type system, so the rule
// needs a TypeScript program — without `parserOptions.project` it is silently
// inert. Building that program makes this package's lint slower, which is why
// it is turned on here rather than repo-wide.
//
// An error, with no standing violations. Every site that parses an identifier
// either resolves it through the VirtualNetwork or carries an inline disable
// saying which guard makes the parse safe there.
module.exports = {
  overrides: [
    {
      files: ['**/*.ts'],
      excludedFiles: ['**/*.d.ts'],
      parser: '@typescript-eslint/parser',
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
      plugins: ['@cardstack/boxel'],
      rules: {
        '@cardstack/boxel/no-url-from-realm-identifier': 'error',
      },
    },
    {
      // A base-realm module is imported by its `@cardstack/base/` prefix, and a
      // prefix realm is named by its prefix rather than the URL one
      // environment serves it at.
      files: ['**/*.ts', 'etc/**/*.js'],
      plugins: ['@cardstack/boxel'],
      rules: {
        '@cardstack/boxel/no-url-form-base-imports': 'error',
        '@cardstack/boxel/no-literal-realm-urls': 'error',
      },
    },
    {
      // Tests build environment-specific realm URLs on purpose, to check how
      // those URLs are resolved and mapped.
      files: ['tests/**'],
      rules: {
        '@cardstack/boxel/no-literal-realm-urls': 'off',
      },
    },
  ],
};
