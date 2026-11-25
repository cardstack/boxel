import { defineConfig } from 'eslint/config';

import {
  DATA_TEST_SELECTORS,
  NODE_GLOBALS,
  NO_COMPILATION_REQUIRED_TS_SELECTORS,
  NO_UNUSED_VARS,
  gtsBlock,
  rootConfig,
} from '../../eslint/shared.mjs';

// contents/ files (both .ts card/command modules and .gts Glimmer components)
// always go through the realm/Ember compilation pipeline, so decorators like
// @field, @tracked, and @action are valid here — only the `Decorator` selector
// is lifted. The remaining erasable-syntax guards (enum, `import =`,
// `export =`, runtime namespaces) still apply, for consistency with the rest
// of the repo.
const ERASABLE_MINUS_DECORATOR = NO_COMPILATION_REQUIRED_TS_SELECTORS.filter(
  (s) => s.selector !== 'Decorator',
);

// `data-test-*` is a test-only hook. Unlike host app builds, the realm card
// pipeline (runtime-common) does NOT strip these attributes, so card selectors
// on them survive to production — but coupling styling/behavior to a test hook
// is fragile (deleting a test selector silently changes production), so it is
// banned in card content too. Tests legitimately select on them, so the
// data-test ban is dropped for test files (see CONTENTS_TEST_RESTRICTED_SYNTAX).
const CONTENTS_RESTRICTED_SYNTAX = [
  'error',
  ...ERASABLE_MINUS_DECORATOR,
  ...DATA_TEST_SELECTORS,
];
const CONTENTS_TEST_RESTRICTED_SYNTAX = ['error', ...ERASABLE_MINUS_DECORATOR];

export default defineConfig([
  ...rootConfig('catalog'),
  {
    files: ['contents/**/*.ts'],
    rules: {
      'no-restricted-syntax': CONTENTS_RESTRICTED_SYNTAX,
    },
  },
  gtsBlock({
    files: ['contents/**/*.gts'],
    rules: {
      'no-restricted-syntax': CONTENTS_RESTRICTED_SYNTAX,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': NO_UNUSED_VARS,
      '@typescript-eslint/ban-ts-comment': 'off',
      // This block re-extends `@typescript-eslint/recommended`, which resets
      // whatever the monorepo-wide config turned off — so the rules card
      // content relies on have to be turned off again here. `{}` type
      // plumbing and bare member reads that register a tracked dependency are
      // both ordinary in card content.
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-wrapper-object-types': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-import-type-side-effects': 'off',
      'ember/no-empty-glimmer-component-classes': 'off',
      'ember/no-test-support-import': 'off',
      'getter-return': 'off',
      'no-undef': 'off',
    },
  }),
  {
    // Tests legitimately select on `data-test-*` (e.g.
    // `assert.dom('[data-test-foo]')`); keep the erasable-syntax guards but
    // drop the data-test ban. This block only resets `no-restricted-syntax`
    // — the parser and extends from the `contents/**/*.gts` block above
    // still apply to `.gts` tests.
    files: [
      'contents/**/*.test.{js,ts,gts,gjs}',
      'contents/**/*-test.{js,ts,gts,gjs}',
      'contents/tests/**',
    ],
    rules: {
      'no-restricted-syntax': CONTENTS_TEST_RESTRICTED_SYNTAX,
    },
  },
  {
    // ESLint 9 added this rule to `eslint:recommended`, and it reports
    // catalog code. It is off here until the catalog's code is fixed.
    files: ['contents/**'],
    rules: { 'no-constant-binary-expression': 'off' },
  },
  {
    // Node tooling: this package's own, and the catalog's scripts.
    ...NODE_GLOBALS,
    files: [
      'scripts/**',
      'lint/**',
      'eslint.config.mjs',
      'contents/scripts/**/*.mjs',
    ],
  },
]);
