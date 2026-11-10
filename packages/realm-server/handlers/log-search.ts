import type Koa from 'koa';
import {
  buildSearchErrorResponse,
  logSearchResponse,
  SupportedMimeType,
  type DBAdapter,
  type LogQuery,
} from '@cardstack/runtime-common';
import { setContextResponse } from '../middleware/index.ts';

// A `_search` whose body names `from: { log }` searches the lines of one of
// the realm's logs (`log-query.ts` in runtime-common), answered exactly as
// the realm's own `_search` answers it (`logSearchResponse`). It runs on one
// realm, which the caller must read outright: a policy grant scopes cards,
// and has no meaning for a log's lines yet.
export async function respondToLogSearch(
  ctxt: Koa.Context,
  payload: LogQuery,
  named: string[],
  readable: string[],
  dbAdapter: DBAdapter,
): Promise<void> {
  if (named.length !== 1) {
    await setContextResponse(
      ctxt,
      buildSearchErrorResponse(
        "Invalid query: a log search runs on one realm's _search",
        400,
      ),
    );
    return;
  }
  let [realm] = named;
  if (!readable.includes(realm)) {
    await setContextResponse(
      ctxt,
      buildSearchErrorResponse(
        'a log search needs read access to the realm',
        403,
      ),
    );
    return;
  }
  let { status, body } = await logSearchResponse(dbAdapter, realm, payload);
  await setContextResponse(
    ctxt,
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': SupportedMimeType.CardJson },
    }),
  );
}
