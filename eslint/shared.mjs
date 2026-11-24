// Building blocks for the packages' flat configs.
//
// ESLint looks up a file's config from the file's own directory, so a
// package's `eslint.config.mjs` is the whole config for its files. A package
// that wants the monorepo-wide rules spreads `rootConfig()` first and layers
// its own blocks after it.
import { createRequire } from 'node:module';

import { fixupPluginRules } from '@eslint/compat';
import js from '@eslint/js';
import { globalIgnores } from 'eslint/config';
import ember from 'eslint-plugin-ember/recommended';
import importX from 'eslint-plugin-import-x';
import n from 'eslint-plugin-n';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import qunitRecommended from 'eslint-plugin-qunit/configs/recommended';
import qunitDom from 'eslint-plugin-qunit-dom';
import globals from 'globals';
import ts from 'typescript-eslint';

export {
  ember,
  globals,
  importX,
  js,
  n,
  prettierRecommended,
  qunitDom,
  qunitRecommended,
  ts,
};

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
  if (!pkg) {
    return globs;
  }
  let prefix = `packages/${pkg}/`;
  return globs
    .filter((glob) => glob.startsWith(prefix))
    .map((glob) => glob.slice(prefix.length));
}

// The monorepo-wide config, for the package named `pkg` (its directory under
// `packages/`). Without `pkg`, for the repository root's own config, which
// also covers packages that have no config of their own.
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

// For a realm whose source ESLint checks for one thing: a base-realm module is
// imported by its `@cardstack/base/` prefix, never the
// `https://cardstack.com/base/` alias. The repository's style rules stay out
// of a realm that has never been formatted to them. The `@typescript-eslint`
// and `import` plugins are registered, with no rules of theirs turned on, so
// inline disables that name their rules still resolve.
export function baseImportsOnlyConfig({ ignores = [] } = {}) {
  return [
    // Only `.ts` and `.gts` are realm source here, as `--ext .ts,.gts` had it.
    globalIgnores(['**/*.{js,mjs,cjs}', ...ignores]),
    {
      // The same files are linted with the rules these directives name
      // elsewhere (the realm lint engine), so they are not unused there.
      linterOptions: { reportUnusedDisableDirectives: 'off' },
      plugins: {
        '@cardstack/boxel': boxel,
        '@typescript-eslint': ts.plugin,
        import: importX,
      },
    },
    {
      files: ['**/*.ts'],
      languageOptions: {
        parser: ts.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    {
      files: ['**/*.gts'],
      languageOptions: GTS_LANGUAGE_OPTIONS,
    },
    {
      files: ['**/*.ts', '**/*.gts'],
      rules: { '@cardstack/boxel/no-url-form-base-imports': 'error' },
    },
  ];
}

// A `.gts` block equivalent to eslintrc's `extends: ['eslint:recommended',
// 'plugin:@typescript-eslint/recommended', 'plugin:ember/recommended',
// 'plugin:ember/recommended-gts', 'plugin:prettier/recommended', ...]`, in
// that order. `extraExtends` follow prettier; `rules` come last.
export function gtsBlock({
  files = ['**/*.gts'],
  ignores,
  extraExtends = [],
  rules = {},
} = {}) {
  return {
    files,
    ...(ignores ? { ignores } : {}),
    extends: [
      js.configs.recommended,
      ESLINT_10_RECOMMENDED_OFF,
      ...ts.configs.recommended,
      ember.configs.gts,
      prettierRecommended,
      ...extraExtends,
    ],
    languageOptions: {
      ...GTS_LANGUAGE_OPTIONS,
      globals: { ...globals.browser },
    },
    rules,
  };
}

// `plugin:qunit-dom/recommended`. eslint-plugin-qunit-dom 1.0.0 calls rule
// context methods that ESLint 10 removed, so its rules are wrapped.
export const QUNIT_DOM_RECOMMENDED = {
  plugins: { 'qunit-dom': fixupPluginRules(qunitDom) },
  rules: qunitDom.configs.recommended.rules,
};

// eslint-plugin-import-x's presets name rules `import-x/...`. The configs here
// register the plugin as `import`, so the presets' rules are renamed to match.
const asImportRules = (rules = {}) =>
  Object.fromEntries(
    Object.entries(rules).map(([name, value]) => [
      name.replace(/^import-x\//, 'import/'),
      value,
    ]),
  );

// `plugin:import/recommended`, with eslint-plugin-import-x.
export const IMPORT_RECOMMENDED = {
  plugins: { import: importX },
  rules: asImportRules(importX.flatConfigs.recommended.rules),
};

// `plugin:import/typescript`, with eslint-plugin-import-x. import-x's own
// preset resolves with eslint-import-resolver-typescript; eslint-plugin-import's
// resolved with Node's algorithm over these extensions, so this keeps that.
const TS_AND_JS_EXTENSIONS = [
  '.ts',
  '.cts',
  '.mts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
];
export const IMPORT_TYPESCRIPT = {
  settings: {
    ...importX.flatConfigs.typescript.settings,
    'import-x/extensions': TS_AND_JS_EXTENSIONS,
    'import-x/resolver': undefined,
    'import-x/resolver-next': [
      importX.createNodeResolver({ extensions: TS_AND_JS_EXTENSIONS }),
    ],
  },
  rules: asImportRules(importX.flatConfigs.typescript.rules),
};
