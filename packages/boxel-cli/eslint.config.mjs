import { defineConfig, globalIgnores } from 'eslint/config';

import { NODE_GLOBALS, rootConfig } from '../../eslint/shared.mjs';

export default defineConfig([
  globalIgnores([
    'dist/',
    'bin/',
    'bundled-types/',
    'bundled-test-harness/',
    'bundled-realms/',
    'tests/fixtures/parse/',
  ]),
  ...rootConfig('boxel-cli'),
  NODE_GLOBALS,
]);
