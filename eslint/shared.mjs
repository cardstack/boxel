// Building blocks for the packages' flat configs.
//
// ESLint looks up a file's config from the file's own directory, so a
// package's `eslint.config.mjs` is the whole config for its files. A package
// that wants the monorepo-wide rules spreads `rootConfig()` first and layers
// its own blocks after it.
import { createRequire } from 'node:module';

import js from '@eslint/js';
import { globalIgnores } from 'eslint/config';
import ember from 'eslint-plugin-ember/recommended';
import n from 'eslint-plugin-n';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import qunitRecommended from 'eslint-plugin-qunit/configs/recommended';
import globals from 'globals';
import ts from 'typescript-eslint';

export { ember, globals, js, n, prettierRecommended, qunitRecommended, ts };

const require = createRequire(import.meta.url);

// ESLint 10 added these to `eslint:recommended`. They are off until the
// code they report is fixed; a config that extends `eslint:recommended`
// spreads this after it.
export const ESLINT_10_RECOMMENDED_OFF = {
  rules: {
    'no-unassigned-vars': 'off',
    'no-useless-assignment': 'off',
    'preserve-caught-error': 'off',
  },
};

// eslintrc never linted dotfiles and dot-directories; flat config does.
// Keep them out, as before.
export const DOTFILE_IGNORES = globalIgnores(['**/.*'], 'dotfiles');

export const boxel = require('@cardstack/eslint-plugin-boxel');
export const {
  NO_COMPILATION_REQUIRED_TS_SELECTORS,
  CJS_GLOBALS_IN_ESM,
} = require('./erasable-syntax-selectors.cjs');
export const { DATA_TEST_SELECTORS } = require('./data-test-selectors.cjs');
export const {
  AMBIENT_CLOCK_SELECTORS,
} = require('./ambient-clock-selectors.cjs');
const {
  CLOUD_PROVIDER_SDK_RULE,
  RUNTIME_PACKAGE_FILES,
  CLOUD_PROVIDER_ADAPTER_MODULES,
} = require('./cloud-provider-sdk-imports.cjs');
export { CLOUD_PROVIDER_SDK_RULE };

// `caughtErrors` defaults to reporting, so a `catch` binding nothing reads
// has to be named or dropped. Left unreported: a caught error is often kept
// for the shape of the catch rather than to be used.
export const NO_UNUSED_VARS = [
  'error',
  { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
];

export const TYPE_IMPORT_RULES = {
  '@typescript-eslint/consistent-type-imports': [
    'error',
    { disallowTypeAnnotations: false },
  ],
  '@typescript-eslint/no-import-type-side-effects': 'error',
};

// The rules every TypeScript package shares.
export const TS_RULES = {
  ...TYPE_IMPORT_RULES,
  'prefer-const': 'off',
  '@typescript-eslint/ban-ts-comment': 'off',
  // `{}` and `Function` are used deliberately, mostly in type plumbing.
  '@typescript-eslint/no-empty-object-type': 'off',
  '@typescript-eslint/no-unsafe-function-type': 'off',
  '@typescript-eslint/no-wrapper-object-types': 'off',
  // Config files and a few CJS interop points require by design.
  '@typescript-eslint/no-require-imports': 'off',
  '@typescript-eslint/prefer-as-const': 'off',
  '@typescript-eslint/no-explicit-any': 'off',
  '@typescript-eslint/no-non-null-assertion': 'off',
  '@typescript-eslint/no-unused-vars': NO_UNUSED_VARS,
  // Keep new code "erasable" so Node can run it via
  // `--experimental-strip-types` (type-only syntax that vanishes when
  // stripped).
  '@typescript-eslint/parameter-properties': [
    'error',
    { prefer: 'class-property' },
  ],
  'no-restricted-syntax': ['error', ...NO_COMPILATION_REQUIRED_TS_SELECTORS],
};

// The parser options every `.gts` block uses.
export const GTS_LANGUAGE_OPTIONS = {
  parser: ember.parser,
  ecmaVersion: 'latest',
  sourceType: 'module',
  parserOptions: {
    requireConfigFile: false,
    babelOptions: {
      plugins: [
        ['@babel/plugin-proposal-decorators', { decoratorsBeforeExport: true }],
      ],
    },
    warnOnUnsupportedTypeScriptVersion: false,
  },
};

// Globs in `cloud-provider-sdk-imports.cjs` are relative to the repository
// root. A package's config matches relative to the package, so keep the
// globs under `packages/<name>/` and strip that prefix.
function forPackage(globs, pkg) {
  let prefix = `packages/${pkg}/`;
  return globs
    .filter((glob) => glob.startsWith(prefix))
    .map((glob) => glob.slice(prefix.length));
}

// The monorepo-wide config, for the package named `pkg` (its directory under
// `packages/`).
export function rootConfig(pkg) {
  let runtimeFiles = forPackage(RUNTIME_PACKAGE_FILES, pkg);
  let adapterModules = forPackage(CLOUD_PROVIDER_ADAPTER_MODULES, pkg);
  return [
    DOTFILE_IGNORES,
    js.configs.recommended,
    ESLINT_10_RECOMMENDED_OFF,
    ...ts.configs.recommended,
    prettierRecommended,
    {
      languageOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        parserOptions: { ecmaFeatures: { legacyDecorators: true } },
      },
      plugins: { ember: ember.plugin, '@cardstack/boxel': boxel },
      rules: TS_RULES,
    },
    {
      files: ['**/*.cjs'],
      languageOptions: { sourceType: 'commonjs' },
    },
    {
      // Disallow data-test-* CSS selectors in app code across all packages.
      // ember-test-selectors strips these attributes in production, so
      // selectors like querySelector('[data-test-foo]') silently break
      // outside of tests.
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
      // Ban the CommonJS-only `__dirname`/`__filename` globals in TS source
      // under `src/` and `scripts/`: the surface that runs or gets imported as
      // native ESM, where they are `undefined`. Bundle-only modules opt out
      // per-line.
      files: ['**/src/**/*.{ts,mts}', '**/scripts/**/*.{ts,mts}'],
      rules: { 'no-restricted-globals': ['error', ...CJS_GLOBALS_IN_ESM] },
    },
    ...(runtimeFiles.length
      ? [
          {
            // Cloud provider SDKs only in adapter modules (ADR 003 §1.2).
            files: runtimeFiles,
            ignores: ['**/tests/**'],
            rules: {
              '@cardstack/boxel/no-cloud-provider-sdk': CLOUD_PROVIDER_SDK_RULE,
            },
          },
        ]
      : []),
    ...(adapterModules.length
      ? [
          {
            files: adapterModules,
            rules: { '@cardstack/boxel/no-cloud-provider-sdk': 'off' },
          },
        ]
      : []),
  ];
}

// QUnit's recommended rules for a package's test modules.
export function qunitTests(files) {
  return {
    files,
    extends: [qunitRecommended],
    rules: {
      'qunit/require-expect': 'off',
      'qunit/no-conditional-assertions': 'off',
    },
  };
}

// For a package whose code all runs in Node.
export const NODE_GLOBALS = {
  name: 'node globals',
  languageOptions: { globals: globals.node },
};
