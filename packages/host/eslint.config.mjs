import { createRequire } from 'node:module';

import { defineConfig, globalIgnores } from 'eslint/config';

import {
  CLOUD_PROVIDER_SDK_RULE,
  DATA_TEST_SELECTORS,
  ESLINT_10_RECOMMENDED_OFF,
  GTS_LANGUAGE_OPTIONS,
  IMPORT_RECOMMENDED,
  IMPORT_TYPESCRIPT,
  QUNIT_DOM_RECOMMENDED,
  boxel,
  ember,
  globals,
  js,
  n,
  prettierRecommended,
  qunitTests,
  ts,
} from '../../eslint/shared.mjs';
import cardstackHost from '../eslint-plugin-cardstack-host/lib/index.js';

const require = createRequire(import.meta.url);
const MISSING_INVOKABLES_CONFIG = require('../runtime-common/etc/eslint/missing-invokables-config');

const withoutFiles = ({ files, ...config }) => config;

// What eslintrc's `extends` gave JS, TS, GJS and GTS in the browser context,
// in its order: eslint:recommended, ember/recommended, typescript-eslint,
// ember/recommended-gts, prettier, qunit-dom, boxel, host. `ember` is the
// ember preset for the file type.
const sharedBrowserExtends = (emberPreset) => [
  js.configs.recommended,
  ESLINT_10_RECOMMENDED_OFF,
  emberPreset,
  ...ts.configs.recommended,
  { rules: { 'ember/template-no-let-reference': 'error' } },
  prettierRecommended,
  QUNIT_DOM_RECOMMENDED,
  boxel.configs.recommended,
  cardstackHost.configs.recommended,
];

const sharedBrowserRules = {
  '@typescript-eslint/consistent-type-imports': [
    'error',
    {
      disallowTypeAnnotations: false,
    },
  ],
  '@typescript-eslint/no-import-type-side-effects': 'error',
  '@typescript-eslint/no-empty-function': 'off',
  '@typescript-eslint/no-unused-vars': [
    'error',
    // `caughtErrors` defaults to reporting, so a `catch` binding this code
    // does not read has to be named or dropped. Left unreported: a caught
    // error is often kept for the shape of the catch rather than to be used.
    {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrors: 'none',
    },
  ],
  'prefer-const': 'off',
  '@typescript-eslint/no-explicit-any': 'off',
  // `{}` and `Function` are used deliberately here, mostly in type plumbing.
  '@typescript-eslint/no-empty-object-type': 'off',
  '@typescript-eslint/no-unsafe-function-type': 'off',
  '@typescript-eslint/no-wrapper-object-types': 'off',
  // Config files and a few CJS interop points require by design.
  '@typescript-eslint/no-require-imports': 'off',
  // A bare member expression is how a getter consumes a tracked property to
  // register a reactive dependency, and `cond && doThing()` is used as a
  // guard. Both read as unused expressions.
  '@typescript-eslint/no-unused-expressions': 'off',
  '@typescript-eslint/ban-ts-comment': 'off',
  '@typescript-eslint/explicit-module-boundary-types': 'off',
  '@typescript-eslint/no-this-alias': 'off',
  '@typescript-eslint/no-non-null-assertion': 'off',
  'no-undef': 'off',
  'ember/no-runloop': 'off',
  'ember/template-no-let-reference': 'off',
  'ember/no-tracked-properties-from-args': 'off',
  'node/no-deprecated-api': 'off',
  '@cardstack/boxel/template-missing-invokable': [
    'error',
    { invokables: MISSING_INVOKABLES_CONFIG.invokables },
  ],
  '@cardstack/boxel/no-raf-for-state': 'error',
};

// Node-run tooling: build, config and server files.
const NODE_FILES = [
  '.percy.js',
  '.prettierrc.js',
  '.template-lintrc.js',
  'ember-cli-build.js',
  'testem.js',
  'testem-live.js',
  'blueprints/*/index.js',
  'config/**/*.js',
  'lib/**/*.js',
  'lib/**/*.cjs',
  'server/**/*.js',
  'babel.config.cjs',
  'scripts/**/*.js',
];

export default defineConfig([
  globalIgnores([
    'public/test-modules/bad.js',
    'blueprints/*/files/',
    'vendor/',
    'dist/',
    'tmp/',
    '**/*.d.ts',
    'bower_components/',
    'public/olm*',
    'coverage/',
    // Dot-directories, but not dotfiles: this package lints its dotfiles.
    '**/.*/',
  ]),
  {
    languageOptions: { globals: globals.browser },
  },
  {
    // Cloud provider SDKs only in adapter modules, and host has none
    // (ADR 003 §1.2).
    files: ['app/**/*'],
    plugins: { '@cardstack/boxel': boxel },
    rules: {
      '@cardstack/boxel/no-cloud-provider-sdk': CLOUD_PROVIDER_SDK_RULE,
    },
  },
  {
    // Disallow `data-test-*` CSS/DOM selectors in app code. ember-test-selectors
    // strips these attributes in production, so selectors like
    // `querySelector('[data-test-foo]')` silently break outside of tests.
    // Scoped to app code only — tests legitimately select on `data-test-*`.
    files: ['app/**/*.{js,ts,gts,gjs}'],
    rules: {
      'no-restricted-syntax': ['error', ...DATA_TEST_SELECTORS],
    },
  },
  {
    files: ['**/*.{js,ts,mts}'],
    extends: sharedBrowserExtends(withoutFiles(ember.configs.base)),
    languageOptions: {
      parser: ts.parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
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
    rules: sharedBrowserRules,
  },
  {
    files: ['**/*.gts'],
    extends: sharedBrowserExtends(ember.configs.gts),
    languageOptions: GTS_LANGUAGE_OPTIONS,
    rules: sharedBrowserRules,
  },
  // node files
  {
    files: NODE_FILES,
    extends: [n.configs['flat/recommended-script']],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      'n/no-process-exit': 'off',
      'n/hashbang': 'off',
    },
  },
  {
    files: NODE_FILES.filter((glob) => glob.endsWith('.js')),
    rules: {
      // As eslintrc's `plugin:n/recommended` configured it for `.js`.
      'n/no-unsupported-features/es-syntax': [
        'error',
        { ignores: ['modules'] },
      ],
      // ESLint 8's default. ESLint 9 also reports a CommonJS module's own
      // binding named like a global, as `config/fastboot.js` defines `btoa`.
      'no-redeclare': ['error', { builtinGlobals: false }],
    },
  },
  // node ESM files — `.mts` so Node and the type-checker agree they are
  // modules, which a `.ts` under this package's CommonJS default does not.
  {
    files: ['support/**/*.mts'],
    languageOptions: { globals: globals.node },
  },
  // test files
  qunitTests(['tests/**/*-test.{gjs,gts,js,ts}']),
  {
    // don't enforce import order on blueprint files
    files: ['app/**', 'tests/**'],
    ignores: ['app/app.ts', 'app/router.ts', 'tests/test-helper.js'],
    extends: [IMPORT_RECOMMENDED, IMPORT_TYPESCRIPT],
    rules: {
      // sufficiently covered by eslint no-duplicate-imports
      'import/no-duplicates': 'off',
      // this doesn't work well with the monorepo. Typescript already complains if you try to import something that's not found
      'import/no-unresolved': 'off',
      'import/order': [
        'error',
        {
          'newlines-between': 'always-and-inside-groups',
          alphabetize: {
            order: 'asc',
          },
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
            'object',
            'type',
          ],
          pathGroups: [
            {
              pattern: '@ember/**',
              group: 'builtin',
            },
            {
              pattern: '@embroider/**',
              group: 'builtin',
            },
            {
              pattern: '@glimmer/**',
              group: 'builtin',
            },
            {
              pattern: '@cardstack/boxel-ui{*,/**}',
              group: 'internal',
              position: 'before',
            },
            {
              pattern: '@cardstack/runtime-common{*,/**}',
              group: 'internal',
              position: 'before',
            },
            {
              pattern: '@cardstack/host/**',
              group: 'internal',
              position: 'after',
            },
            {
              pattern: '@cardstack**',
              group: 'internal',
            },
            {
              pattern: 'https://cardstack.com/**',
              group: 'internal',
              position: 'after',
            },
          ],
          pathGroupsExcludedImportTypes: [],
        },
      ],
    },
  },
  {
    // Type-aware linting.
    //
    // `no-url-from-realm-identifier` asks whether a value carries one of the
    // realm-identifier brands, which exist only in the type system, so the
    // rule needs a TypeScript program. Without `parserOptions.project` it is
    // silently inert.
    //
    // Scoped to app code. The build and config scripts at the package root
    // are outside `tsconfig.json`, where asking for a program is a parse
    // error rather than a lint result. Tests are left out for signal: they
    // build URLs by interpolating the test realm's identifier, which is
    // always a URL there, so the rule has 476 things to say about them.
    //
    // The parser for each file still comes from the blocks above —
    // `@typescript-eslint/parser` for `.ts`, `ember-eslint-parser` for
    // `.gts` — and only the program is added here.
    files: ['app/**/*.{ts,gts}'],
    ignores: ['**/*.d.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@cardstack/boxel/no-url-from-realm-identifier': 'error',
    },
  },
  {
    // Tests of alias tolerance, canonicalization or migration, which spell
    // the `https://cardstack.com/base/` alias as data. It stays out of their
    // import specifiers.
    files: [
      'tests/integration/resources/search-test.ts',
      'tests/integration/tools/sanitize-module-list-test.gts',
      'tests/unit/code-ref-test.ts',
      'tests/unit/index-query-engine-test.ts',
      'tests/unit/internal-key-canonicalization-test.ts',
      'tests/unit/is-component-declaration-test.ts',
      'tests/unit/loader-test.ts',
      'tests/unit/plan-install-test.ts',
      'tests/unit/query-canonicalization-test.ts',
      'tests/unit/virtual-network-realm-for-reference-test.ts',
      'tests/unit/virtual-network-retry-test.ts',
    ],
    rules: {
      '@cardstack/boxel/no-url-form-base-imports': [
        'error',
        { allowAliasOutsideImports: true },
      ],
    },
  },
  {
    // Tests and fixtures that name base-realm resources by the alias,
    // appending a path to `baseRealm.url`, without testing alias tolerance.
    // Each is a known gap listed under ADR 002 §1.4's Remediation, and
    // leaves this list when it names those resources in prefix form.
    files: [
      'tests/acceptance/ai-assistant-test.gts',
      'tests/acceptance/code-submode/create-file-test.gts',
      'tests/acceptance/code-submode/file-tree-test.ts',
      'tests/acceptance/code-submode/recent-files-test.ts',
      'tests/acceptance/interact-submode-creation-and-permissions-test.gts',
      'tests/acceptance/interact-submode/create-file-test.gts',
      'tests/acceptance/prerender-file-extract-test.gts',
      'tests/integration/components/card-chooser-paging-test.gts',
      'tests/integration/components/operator-mode-card-chooser-test.gts',
      'tests/integration/components/realm-config-routing-rule-edit-test.gts',
      'tests/unit/filedef-export-shape-test.ts',
      'tests/unit/instance-filter-matcher-test.ts',
      'tests/unit/module-transpile-cache-test.ts',
    ],
    rules: {
      '@cardstack/boxel/no-url-form-base-imports': [
        'error',
        { allowBaseRealmURLPaths: true },
      ],
    },
  },
  {
    // A prefix realm is named by its prefix rather than the URL one
    // environment serves it at. Tests are left out: they spell those URLs on
    // purpose, to check how they are resolved and mapped.
    files: ['app/**/*.{js,ts,gts,gjs}'],
    rules: {
      '@cardstack/boxel/no-literal-realm-urls': 'error',
    },
  },
]);
