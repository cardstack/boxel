/**
 * Lint rules shared by the Choreo packages: glimmer-motion, choreo,
 * choreo-player, choreo-gallery and choreo-test-app.
 *
 * They follow packages/boxel-ui/eslint.config.mjs minus the boxel-specific
 * plugins: simple-import-sort, sorted interface keys, curly braces everywhere,
 * prettier.
 *
 * A package's eslint.config.mjs lists this config first, then only what
 * differs for that package:
 *
 *   export default defineConfig([
 *     globalIgnores(['public/vendor/']),
 *     base,
 *     { files: ['src/legacy/**'], rules: { ... } },
 *   ]);
 */
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import ember from 'eslint-plugin-ember/recommended';
import n from 'eslint-plugin-n';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import typescriptSortKeys from 'eslint-plugin-typescript-sort-keys';
import globals from 'globals';
import ts from 'typescript-eslint';

const esmParserOptions = {
  ecmaFeatures: { modules: true },
  ecmaVersion: 'latest',
};

/**
 * TypeScript syntax that emits runtime code, which type stripping cannot
 * erase. Flat config replaces a rule's options rather than merging them, so a
 * block that sets `no-restricted-syntax` spreads these into its own options to
 * keep them.
 */
export const erasableSyntax = [
  {
    selector: 'TSEnumDeclaration',
    message:
      'TypeScript `enum` is not erasable; use a `const` object with `as const` or a union of string literals.',
  },
  {
    selector: 'TSParameterProperty',
    message:
      'Parameter properties are not erasable; declare the class property explicitly.',
  },
  {
    selector: 'TSModuleDeclaration:not([declare=true])',
    message:
      'TypeScript `namespace`/`module` blocks emit runtime code and are not erasable.',
  },
];

/**
 * Lints `files` as CommonJS Node scripts: Node globals, eslint-plugin-n's
 * recommended rules, and `require` allowed. Every `.cjs` file gets this;
 * a package passes the `.js` files it loads through `require`, such as
 * ember-cli's config files.
 */
export function commonjs(files) {
  return {
    files,
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    extends: [n.configs['flat/recommended']],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  };
}

export default defineConfig([
  globalIgnores([
    '**/dist/',
    '**/dist-*/',
    '**/declarations/',
    '**/coverage/',
    '**/node_modules/',
    '**/tmp/',
  ]),
  js.configs.recommended,
  prettier,
  ember.configs.base,
  ember.configs.gjs,
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  {
    files: ['**/*.{js,gjs}'],
    languageOptions: {
      parserOptions: esmParserOptions,
      globals: { ...globals.browser },
    },
  },
  {
    files: ['**/*.{ts,gts}'],
    languageOptions: { parser: ember.parser, globals: { ...globals.browser } },
    // ember's gts config follows typescript-eslint's so that its parser and
    // processor win for .gts files
    extends: [...ts.configs.recommended, ember.configs.gts],
  },
  {
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      curly: 'error',
      'prefer-const': 'off',
      'simple-import-sort/exports': 'error',
      'simple-import-sort/imports': 'error',
    },
  },
  {
    files: ['**/*.{ts,gts}'],
    plugins: { 'typescript-sort-keys': typescriptSortKeys },
    rules: {
      'typescript-sort-keys/interface': 'error',
      'typescript-sort-keys/string-enum': 'error',
      // TypeScript checks these; eslint's own no-undef does not know types or template scope
      'no-undef': 'off',
      'no-redeclare': ['error', { builtinGlobals: false }],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { disallowTypeAnnotations: false },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'no-restricted-syntax': ['error', ...erasableSyntax],
    },
  },
  {
    // node-side ES module config and scripts
    files: ['**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      parserOptions: esmParserOptions,
      globals: { ...globals.node },
    },
    extends: [n.configs['flat/recommended']],
  },
  commonjs(['**/*.cjs']),
]);
