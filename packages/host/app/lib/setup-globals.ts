import { Buffer } from 'buffer';

import { makeLogDefinitions } from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';

(globalThis as any)._logDefinitions =
  (globalThis as any)._logDefinitions ?? makeLogDefinitions(ENV.logLevels);

(globalThis as any).Buffer = Buffer;

// we use globalThis for this particular feature flag so that we can control it
// within a fastboot context as well
(globalThis as any).__enablePgIndexer =
  (globalThis as any).__enablePgIndexer ?? ENV.featureFlags?.['pg-indexer'];
