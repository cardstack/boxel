'use strict';

// Selectors for TypeScript syntax that Node 24+ cannot run via
// `--experimental-strip-types` (it only handles "erasable" TS). The
// migration target — see Linear project "Migrate off ts-node to run
// directly in node 24+" — requires keeping new code free of these.
const NO_COMPILATION_REQUIRED_TS_SELECTORS = [
  {
    selector: 'TSEnumDeclaration',
    message:
      'TypeScript `enum` is not erasable and requires compilation. Use a `const` object with `as const` (or a union of string literals) instead.',
  },
  {
    selector: 'TSImportEqualsDeclaration',
    message:
      '`import =` syntax requires TypeScript compilation. Use standard ES module `import` instead.',
  },
  {
    selector: 'TSExportAssignment',
    message:
      '`export =` syntax requires TypeScript compilation. Use a standard ES module `export default` (or named exports) instead.',
  },
];

const DATA_TEST_SELECTORS = [
  {
    selector: 'Literal[value=/\\[data-test-/]',
    message:
      '`data-test-*` attributes are stripped in production builds. Use a plain `data-*` attribute (e.g. `[data-foo]`) for functional selectors.',
  },
  {
    selector: 'TemplateElement[value.raw=/\\[data-test-/]',
    message:
      '`data-test-*` attributes are stripped in production builds. Use a plain `data-*` attribute (e.g. `[data-foo]`) for functional selectors.',
  },
];

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    ecmaFeatures: {
      legacyDecorators: true,
    },
  },
  plugins: ['ember'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  rules: {
    '@typescript-eslint/consistent-type-imports': [
      'error',
      {
        disallowTypeAnnotations: false,
      },
    ],
    '@typescript-eslint/no-import-type-side-effects': 'error',
    // this doesn't work well with the monorepo. Typescript already complains if you try to import something that's not found
    'import/no-unresolved': 'off',
    'prefer-const': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    '@typescript-eslint/ban-types': 'off',
    '@typescript-eslint/prefer-as-const': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    // Keep new code "erasable" so it can run under Node's
    // `--experimental-strip-types` without ts-node.
    '@typescript-eslint/parameter-properties': [
      'error',
      { prefer: 'class-property' },
    ],
    'no-restricted-syntax': ['error', ...NO_COMPILATION_REQUIRED_TS_SELECTORS],
  },
  overrides: [
    {
      // Disallow data-test-* CSS selectors in app code across all packages.
      // ember-test-selectors strips these attributes in production, so selectors
      // like querySelector('[data-test-foo]') silently break outside of tests.
      files: ['**/app/**/*.{js,ts,gts,gjs}', '**/src/**/*.{js,ts,gts,gjs}'],
      rules: {
        'no-restricted-syntax': [
          'error',
          ...NO_COMPILATION_REQUIRED_TS_SELECTORS,
          ...DATA_TEST_SELECTORS,
        ],
      },
    },
    {
      // Files predating the "non-erasable TypeScript" lint rules added for
      // the ts-node → Node-native-TypeScript migration. New files MUST NOT
      // be added to these lists; refactor a grandfathered file to remove
      // its entry as part of that migration.
      files: [
        'packages/bot-runner/lib/command-runner.ts',
        'packages/bot-runner/lib/github.ts',
        'packages/bot-runner/lib/pr-listing/create-listing-pr-handler.ts',
        'packages/bot-runner/lib/pr-listing/pr-listing-workflow-handler.ts',
        'packages/boxel-cli/src/commands/realm/pull.ts',
        'packages/boxel-cli/src/commands/realm/push.ts',
        'packages/boxel-cli/src/commands/realm/status.ts',
        'packages/boxel-cli/src/commands/realm/sync.ts',
        'packages/boxel-cli/src/lib/realm-sync-base.ts',
        'packages/matrix/helpers/isolated-realm-server.ts',
        'packages/postgres/pg-queue.ts',
        'packages/postgres/pg-transaction-manager.ts',
        'packages/realm-server/node-realm.ts',
        'packages/realm-test-harness/src/support-services.ts',
        'packages/runtime-common/amd-transpile/identifier-rewriter.ts',
        'packages/runtime-common/commands.ts',
        'packages/runtime-common/index-writer.ts',
        'packages/runtime-common/matrix-backend-authentication.ts',
        'packages/runtime-common/queue.ts',
        'packages/runtime-common/realm-auth-client.ts',
        'packages/vscode-boxel-tools/src/local-file-system.ts',
        'packages/vscode-boxel-tools/src/realms.ts',
        'packages/vscode-boxel-tools/src/skills.ts',
        'packages/vscode-boxel-tools/src/synapse-auth-provider.ts',
        'packages/workspace-sync-cli/src/pull.ts',
        'packages/workspace-sync-cli/src/push.ts',
        'packages/workspace-sync-cli/src/realm-sync-base.ts',
      ],
      rules: {
        '@typescript-eslint/parameter-properties': 'off',
      },
    },
    {
      // Same grandfathering as above, but for the `enum` selector. The
      // surrounding `data-test-*` selectors don't apply to these files,
      // so it's safe to disable `no-restricted-syntax` wholesale here.
      files: [
        'packages/runtime-common/router.ts',
        'packages/runtime-common/supported-mime-type.ts',
      ],
      rules: {
        'no-restricted-syntax': 'off',
      },
    },
  ],
};
