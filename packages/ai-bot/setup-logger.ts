import { makeLogDefinitions } from '@cardstack/runtime-common';
import { logger as matrixJsLogger } from 'matrix-js-sdk/lib/logger';

if (process.env.DISABLE_MATRIX_JS_LOGGING === 'TRUE') {
  matrixJsLogger.disableAll();
}
(globalThis as any)._logDefinitions = makeLogDefinitions(
  process.env.LOG_LEVELS || '*=info',
);
