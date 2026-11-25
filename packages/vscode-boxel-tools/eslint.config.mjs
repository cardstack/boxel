import { defineConfig, globalIgnores } from 'eslint/config';

import { NODE_GLOBALS, rootConfig } from '../../eslint/shared.mjs';

export default defineConfig([
  globalIgnores(['dist/', 'out/']),
  ...rootConfig('vscode-boxel-tools'),
  NODE_GLOBALS,
]);
