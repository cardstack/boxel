import { defineConfig } from 'eslint/config';

import { NODE_GLOBALS, rootConfig } from '../../eslint/shared.mjs';

export default defineConfig([
  ...rootConfig('ai-assistant-evals'),
  NODE_GLOBALS,
]);
