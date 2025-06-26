import { makeLogDefinitions } from '@cardstack/runtime-common';
(globalThis as any)._logDefinitions = makeLogDefinitions(
  process.env.WORKER_LOG_LEVELS || process.env.LOG_LEVELS || '*=info',
);
