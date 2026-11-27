import { defineConfig } from 'eslint/config';

import {
  NODE_GLOBALS,
  globals,
  n,
  qunitTests,
  rootConfig,
  ts,
} from '../../eslint/shared.mjs';

// The migration runner treats every file in these directories as a
// migration, so their lint config lives here rather than beside them. They
// get only the block below, not the package's other rules.
const MIGRATIONS = ['migrations/**', 'migrations-removal/**'];

const isGlobalIgnore = (config) =>
  Object.keys(config).every((key) => key === 'ignores' || key === 'name');

export default defineConfig([
  ...[...rootConfig('postgres'), NODE_GLOBALS].map((config) =>
    isGlobalIgnore(config)
      ? config
      : { ...config, ignores: [...(config.ignores ?? []), ...MIGRATIONS] },
  ),
  qunitTests(['tests/**/*-test.{js,ts}']),
  {
    files: MIGRATIONS.map((dir) => `${dir}/*.js`),
    extends: [n.configs['flat/recommended-script']],
    languageOptions: {
      parser: ts.parser,
      sourceType: 'script',
      globals: globals.node,
    },
    rules: {
      camelcase: 'off',
      // Migrations use ES module syntax.
      'n/no-unsupported-features/es-syntax': [
        'error',
        { ignores: ['modules'] },
      ],
    },
  },
]);
