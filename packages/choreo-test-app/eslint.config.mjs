/**
 * Lint rules for the Choreo test app (the gallery and test suite).
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
    // third-party decoder binaries served as static assets
    'public/draco/',
    'public/asset/towers/three-149.js',
    'public/asset/sagrada/three-149.js',
    'public/asset/sagrada/r185/**',
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
    /**
     * The app is served from a sub-path in production and from `/` in every
     * dev server and every test, so a root-absolute path to a public asset is
     * correct everywhere it is ever exercised and a 404 on the only place it
     * ships. Nothing rewrites these: Vite rewrites the tags it emits into
     * index.html and it rewrites `?url` imports, but a hand-written string
     * handed to a loader is just a string.
     *
     * The failure is silent, which is the reason for a rule rather than a
     * note: a Draco decoder that 404s leaves the GLTF load hanging, so the
     * canvas is never sized and the scene renders as a blank default with no
     * exception raised.
     *
     * Build these from `config.rootURL`, which is the same `APP_BASE` that
     * sets Vite's `base`.
     */
    files: ['app/**/*.{ts,gts}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'Literal[value=/^\\/(draco|models|still|og\\.png|robots\\.txt|xstress-loop\\.mp4)/]',
          message:
            'Public assets must be addressed from config.rootURL: a root-absolute path 404s wherever the app is not served from /. Use `${config.rootURL}models/thing.glb`.',
        },
      ],
    },
  },
  {
    // node-side config and scripts
    files: [
      '**/*.{cjs,mjs}',
      'testem.js',
      'ember-cli-build.js',
      'config/**/*.js',
    ],
    languageOptions: { globals: { ...globals.node } },
    extends: [n.configs['flat/recommended']],
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { sourceType: 'module', parserOptions: esmParserOptions },
  },
  {
    files: [
      '**/*.cjs',
      'testem.js',
      'ember-cli-build.js',
      '.template-lintrc.js',
      'config/**/*.js',
    ],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
]);
