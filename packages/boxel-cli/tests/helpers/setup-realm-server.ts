import { makeLogDefinitions } from '@cardstack/runtime-common';

(globalThis as any)._logDefinitions = makeLogDefinitions('*=warn');

// The realm server's module transpiler expects a global `ContentTagGlobal`
// referencing the `content-tag` package — without it, any `.gts` fetch
// with `Accept: */*` fails with 406 "ContentTagGlobal is not defined".
// realm-server's own tests set the same global in `tests/index.ts`.
import * as ContentTagGlobal from 'content-tag';
(globalThis as any).ContentTagGlobal = ContentTagGlobal;
