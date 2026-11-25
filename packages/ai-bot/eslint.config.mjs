import { defineConfig } from 'eslint/config';

import {
  CLOUD_PROVIDER_SDK_RULE,
  NODE_GLOBALS,
  rootConfig,
} from '../../eslint/shared.mjs';

export default defineConfig([
  ...rootConfig('ai-bot'),
  NODE_GLOBALS,
  {
    // Cloud provider SDKs only in adapter modules (ADR 003 §1.2), and ai-bot
    // has none.
    rules: {
      '@cardstack/boxel/no-cloud-provider-sdk': CLOUD_PROVIDER_SDK_RULE,
      // The shared rules turn this off; ai-bot keeps it on.
      '@typescript-eslint/no-require-imports': 'error',
    },
  },
]);
