import { makeLogDefinitions } from '@cardstack/runtime-common';

(globalThis as any)._logDefinitions = makeLogDefinitions('*=warn');
