import ENV from '@cardstack/host/config/environment';
import { Buffer } from 'buffer';
import { makeLogDefinitions } from '@cardstack/runtime-common';

(globalThis as any)._logDefinitions =
  (globalThis as any)._logDefinitions ?? makeLogDefinitions(ENV.logLevels);

globalThis.Buffer = Buffer;
