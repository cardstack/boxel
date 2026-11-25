import { defineConfig } from 'eslint/config';

import { NODE_GLOBALS, qunitTests, rootConfig } from '../../eslint/shared.mjs';

export default defineConfig([
  ...rootConfig('billing'),
  NODE_GLOBALS,
  qunitTests(['tests/**/*-test.{js,ts}']),
]);
