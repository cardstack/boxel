import { defineConfig } from 'eslint/config';

import { NODE_GLOBALS, rootConfig } from '../../eslint/shared.mjs';

export default defineConfig([...rootConfig('bot-runner'), NODE_GLOBALS]);
