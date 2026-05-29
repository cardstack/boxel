import './setup-localhost-resolver';
import './lib/unbuffer-stdio';
import { makeLogDefinitions } from '@cardstack/runtime-common';
(globalThis as any)._logDefinitions = makeLogDefinitions(
  process.env.LOG_LEVELS || '*=info',
);
