import { defineConfig, globalIgnores } from 'eslint/config';

import { NODE_GLOBALS, qunitTests, rootConfig } from '../../eslint/shared.mjs';

export default defineConfig([
  globalIgnores(['experiment_1/', 'playwright-report/', 'test-results/']),
  ...rootConfig('software-factory'),
  NODE_GLOBALS,
  qunitTests(['tests/**/*-test.{js,ts}', 'tests/**/*.test.ts']),
]);
