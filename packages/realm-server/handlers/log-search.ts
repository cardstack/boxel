import type Koa from 'koa';
import {
  buildSearchErrorResponse,
  LogQueryError,
  runLogQuery,
  SupportedMimeType,
  type DBAdapter,
  type LogQuery,
} from '@cardstack/runtime-common';
import { setContextResponse } from '../middleware/index.ts';

// A `_search` whose body names `from: { log }` searches the lines of one of
// the realm's logs (`log-query.ts` in runtime-common). It runs on one realm,
// which the caller must read outright: a policy grant scopes cards, and has
// no meaning for a log's lines yet.
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
      new Response(
        JSON.stringify({
          errors: [
            {
              status: '403',
              title: 'Forbidden',
              detail: `A log search needs read access to ${realm}`,
            },
          ],
        }),
        { status: 403, headers: { 'content-type': SupportedMimeType.JSON } },
      ),
    );
    return;
  }
  try {
    let result = await runLogQuery(dbAdapter, realm, payload);
    await setContextResponse(
      ctxt,
      new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'content-type': SupportedMimeType.JSON },
      }),
    );
  } catch (e) {
    if (e instanceof LogQueryError) {
      await setContextResponse(
        ctxt,
        buildSearchErrorResponse(`Invalid query: ${e.message}`, 400),
      );
      return;
    }
    throw e;
  }
}
