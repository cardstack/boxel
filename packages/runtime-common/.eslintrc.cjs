'use strict';

// Type-aware linting, scoped to this package.
//
// `no-url-from-realm-identifier` asks whether a value carries one of the
// realm-identifier brands. Those exist only in the type system, so the rule
// needs a TypeScript program — without `parserOptions.project` it is silently
// inert. Building that program makes this package's lint slower, which is why
// it is turned on here rather than repo-wide.
//
// Reporting as a warning to start: the existing sites need triage into "really
// is the network boundary" and "should never have parsed this", and a warning
// surfaces them without blocking anyone mid-triage. It becomes an error once
// that list is empty.
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
        '@cardstack/boxel/no-url-from-realm-identifier': 'warn',
      },
    },
    // TEMPORARY, paired with lint-rule-demo.ts: raises the rule to an error for
    // that one file so a CI lint job fails on it and nothing else. Revert the
    // commit that added both.
    {
      files: ['lint-rule-demo.ts'],
      rules: {
        '@cardstack/boxel/no-url-from-realm-identifier': 'error',
      },
    },
  ],
};
