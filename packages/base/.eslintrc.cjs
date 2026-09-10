'use strict';

const {
  NO_COMPILATION_REQUIRED_TS_SELECTORS,
} = require('../../eslint/erasable-syntax-selectors.cjs');
const { DATA_TEST_SELECTORS } = require('../../eslint/data-test-selectors.cjs');

// Everything in this package is card code, compiled by the realm's transform
// pipeline rather than run directly by Node, so decorators (`@field`,
// `@tracked`, `@action`) are valid here and only the `Decorator` selector is
// lifted from the erasable-syntax guards. The remaining guards (enum,
// `import =`, `export =`, runtime namespaces) still apply, for consistency with
// the rest of the repo.
const ERASABLE_MINUS_DECORATOR = NO_COMPILATION_REQUIRED_TS_SELECTORS.filter(
  (s) => s.selector !== 'Decorator',
);

// The realm pipeline does not strip `data-test-*` attributes, so a selector on
// one would keep working in production — but it couples behavior to a hook
// that exists for tests and may be deleted with them. Banned here as it is in
// catalog contents; this package has no tests of its own to exempt.
const CARD_CODE_RESTRICTED_SYNTAX = [
  'error',
  ...ERASABLE_MINUS_DECORATOR,
  ...DATA_TEST_SELECTORS,
];

// Rules that apply to `.ts` and `.gts` alike.
const CARD_CODE_RULES = {
  'no-restricted-syntax': CARD_CODE_RESTRICTED_SYNTAX,
  // A field descriptor builds its component class inside a method, and that
  // class (and its template) can only reach the field through a captured
  // alias of the outer `this`. The Proxy handlers in `watched-array.ts` are
  // in the same position.
  '@typescript-eslint/no-this-alias': 'off',
  // `requestAnimationFrame` callbacks that write tracked state run outside
  // Glimmer's render loop and are invisible to the test waiters.
  '@cardstack/boxel/no-raf-for-state': 'error',
};

module.exports = {
  overrides: [
    {
      // `.ts` modules inherit the monorepo root config (parser, type-import
      // rules, erasable-syntax guards); only the card-code adjustments above
      // are layered on.
      files: ['**/*.ts'],
      plugins: ['@cardstack/boxel'],
      rules: CARD_CODE_RULES,
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
      extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:ember/recommended',
        'plugin:ember/recommended-gts',
        'plugin:prettier/recommended',
        'plugin:@cardstack/boxel/recommended',
      ],
      rules: {
        ...CARD_CODE_RULES,
        // A type-only import that lacks the `type` keyword asks the module
        // system for a binding that does not exist at runtime. Whether a
        // consumer's compiler elides that binding or fails on it depends on
        // its settings, so the distinction is enforced here as it is
        // everywhere else in the repo.
        '@typescript-eslint/consistent-type-imports': [
          'error',
          {
            disallowTypeAnnotations: false,
          },
        ],
        '@typescript-eslint/no-import-type-side-effects': 'error',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrors: 'none',
          },
        ],
        '@typescript-eslint/ban-ts-comment': 'off',
        // This override re-extends `@typescript-eslint/recommended`, which
        // resets whatever the monorepo root turned off — so the rules card
        // code relies on have to be turned off again here. `{}` type
        // plumbing and bare member reads that register a tracked dependency
        // are both ordinary in card code.
        '@typescript-eslint/no-empty-object-type': 'off',
        '@typescript-eslint/no-unsafe-function-type': 'off',
        '@typescript-eslint/no-wrapper-object-types': 'off',
        '@typescript-eslint/no-require-imports': 'off',
        '@typescript-eslint/no-unused-expressions': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        // `@typescript-eslint/eslint-recommended` turns these core rules off
        // for `.ts` because the type checker already covers them (function
        // overloads read as redeclarations, for instance), but it selects by
        // file extension and never sees `.gts`. Off here for the same reason.
        'getter-return': 'off',
        'no-dupe-class-members': 'off',
        'no-redeclare': 'off',
        'no-undef': 'off',
        // This repo declares with `let` (`prefer-const` is off at the root),
        // and this rule flags every `let` binding a template reads, whether or
        // not it is ever reassigned.
        'ember/template-no-let-reference': 'off',
        // `schedule('afterRender', …)` is how card code defers a DOM read past
        // Glimmer's commit; the suggested replacements are not dependencies of
        // card code.
        'ember/no-runloop': 'off',
        'ember/no-empty-glimmer-component-classes': 'off',
        'ember/no-test-support-import': 'off',
      },
    },
    {
      // Node-run tooling at the package root, not card code.
      files: ['./.eslintrc.cjs', './.template-lintrc.js', './scripts/**/*.mjs'],
      env: {
        browser: false,
        node: true,
      },
    },
    {
      files: ['./.eslintrc.cjs', './.template-lintrc.js'],
      parserOptions: {
        sourceType: 'script',
      },
    },
  ],
};
