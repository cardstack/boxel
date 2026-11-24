import { defineConfig, globalIgnores } from 'eslint/config';

import {
  boxel,
  globals,
  qunitRecommended,
  rootConfig,
} from '../../eslint/shared.mjs';

export default defineConfig([
  globalIgnores(['scripts/bench-realm/fixtures/', 'realms/']),
  ...rootConfig('realm-server'),
  {
    // Everything here runs in Node.
    languageOptions: { globals: globals.node },
  },
  {
    files: ['tests/**/*-test.{js,ts}'],
    extends: [qunitRecommended],
    plugins: { '@cardstack/boxel': boxel },
    rules: {
      'qunit/require-expect': 'off',
      'qunit/no-conditional-assertions': 'off',
      '@cardstack/boxel/realm-server-test-template-database': 'error',
    },
  },
]);
