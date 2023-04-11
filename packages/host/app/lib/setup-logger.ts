import ENV from '@cardstack/host/config/environment';
import { makeLogDefinitions } from '@cardstack/runtime-common';

(globalThis as any)._logDefinitions =
  (globalThis as any)._logDefinitions ?? makeLogDefinitions(ENV.logLevels);
