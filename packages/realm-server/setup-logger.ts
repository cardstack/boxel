import './setup-localhost-resolver';
import './lib/unbuffer-stdio';
import {
  makeLogDefinitions,
  reapplyLogLevels,
} from '@cardstack/runtime-common';
(globalThis as any)._logDefinitions = makeLogDefinitions(
  process.env.LOG_LEVELS || '*=info',
);
// Importing the barrel above eagerly evaluates module-scope `logger()`
// calls (e.g. in definition-lookup.ts) before `_logDefinitions` is set,
// leaving those loggers at loglevel's default. Re-apply the configured
// levels now that the definitions are installed so category overrides
// (e.g. `definition-cache-key=debug`) actually take effect.
reapplyLogLevels();
