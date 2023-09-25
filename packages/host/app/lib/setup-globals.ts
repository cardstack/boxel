import { Buffer } from 'buffer';

import { makeLogDefinitions } from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';

(globalThis as any)._logDefinitions =
  (globalThis as any)._logDefinitions ?? makeLogDefinitions(ENV.logLevels);

(globalThis as any).Buffer = Buffer;
