import { Buffer } from 'buffer';

import {
  makeLogDefinitions,
  reapplyLogLevels,
} from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';

(globalThis as any)._logDefinitions =
  (globalThis as any)._logDefinitions ?? makeLogDefinitions(ENV.logLevels);
reapplyLogLevels();

(globalThis as any).Buffer = Buffer;
(globalThis as any).__environment = ENV.environment;
