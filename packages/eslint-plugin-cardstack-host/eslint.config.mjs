import { defineConfig } from 'eslint/config';

import { NODE_GLOBALS, rootConfig } from '../../eslint/shared.mjs';

export default defineConfig([
  ...rootConfig('eslint-plugin-cardstack-host'),
  NODE_GLOBALS,
  {
    files: ['**/*.js'],
    languageOptions: { sourceType: 'commonjs' },
  },
]);
