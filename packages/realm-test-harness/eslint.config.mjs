import { defineConfig } from 'eslint/config';

import { NODE_GLOBALS, rootConfig } from '../../eslint/shared.mjs';

export default defineConfig([
  ...rootConfig('realm-test-harness'),
  NODE_GLOBALS,
]);
