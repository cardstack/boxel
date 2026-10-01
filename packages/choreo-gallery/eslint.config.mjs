/**
 * Lint rules for choreo-gallery.
 *
 * Carried over from the cardstack/choreo root config, which follows
 * packages/boxel-ui/eslint.config.mjs minus the boxel-specific plugins:
 * simple-import-sort, sorted interface keys, curly braces everywhere, prettier.
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

export default defineConfig([
  globalIgnores([
    '**/dist/',
    '**/dist-*/',
    '**/declarations/',
    '**/coverage/',
    '**/node_modules/',
    '**/tmp/',
    // Boxel copies are generated from the already-linted gallery sources.
    'public/**',
    'src/components/**/*',
    '!src/components/{gallery-site,site-frame,demo-stage,special-stages,host-link,raw-document-frame}.gts',
    'src/lib/**/*',
    '!src/lib/{theme,host-navigation}.ts',
    // the film-graph sketches are proposals written in a syntax that does
    // not exist yet (f.Spine, f.Attach, f.picture.*): read them, don't lint them
    'docs/film-graph/**/*.gts',
    'docs/film-graph/**/*.mjs',
    'out/**',
  ]),
  js.configs.recommended,
  prettier,
  ember.configs.base,
  ember.configs.gjs,
  ember.configs.gts,
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
      'no-restricted-syntax': [
        'error',
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
      ],
    },
  },
  {
    // Node browser checks contain functions evaluated in the page.
    files: ['tools/*widget*.mjs', 'tools/sagrada-model-review.mjs'],
    languageOptions: { globals: { ...globals.browser } },
    settings: { node: { version: '>=22.16.0' } },
  },
  {
    // node-side config and scripts
    files: ['**/*.{cjs,mjs}'],
    languageOptions: { globals: { ...globals.node } },
    extends: [n.configs['flat/recommended']],
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { sourceType: 'module', parserOptions: esmParserOptions },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
]);
