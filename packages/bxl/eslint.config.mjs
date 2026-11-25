import { defineConfig, globalIgnores } from 'eslint/config';

import { NODE_GLOBALS, rootConfig } from '../../eslint/shared.mjs';

export default defineConfig([
  globalIgnores(['dist/']),
  ...rootConfig('bxl'),
  { ...NODE_GLOBALS, files: ['scripts/**'] },
]);
