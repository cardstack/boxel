import type Koa from 'koa';
import {
  buildSearchErrorBody,
  logSearchResponse,
  SupportedMimeType,
  type DBAdapter,
  type LogQuery,
} from '@cardstack/runtime-common';
import { setContextResponse } from '../middleware/index.ts';

// The realm a federated log search runs on, when it is mounted here, and who
// the caller is to it.
export interface FederatedLogSearchOptions {
  // The mounted realm for a URL, whose own log search (`searchLogLines`)
  // answers the request: it syncs a log no pass has reached yet and applies
  // its policy's log-line grants.
  realmFor?: (url: string) =>
    | {
        searchLogLines(
          payload: LogQuery,
          caller: { readsRealm: boolean; user?: string },
        ): Promise<{ status: number; body: unknown }>;
      }
    | undefined;
  // The realms the caller may not read that the request may reach through
  // their policies.
  grantCandidates?: string[];
  // The signed-in user the request was verified for, if any.
  user?: string;
}

const NOT_READABLE =
  'a log search needs read access to the realm, or a grant on its log lines';

// A federated `_search` whose body names `from: { log }` (or `{ logs }`)
// searches the lines of one realm's logs, answered exactly as that realm's
// own `_search` answers it. The body's `realms` must name exactly that one
// realm, and is the federated route's member, not the log query's: it is
// taken off before the query is read. A caller who reads the realm reads
// every line; one reaching it only through its policy reads what its
// log-line grants admit; anyone else is refused.
export async function respondToLogSearch(
  ctxt: Koa.Context,
  payload: LogQuery,
  named: string[],
  readable: string[],
  dbAdapter: DBAdapter,
  opts: FederatedLogSearchOptions = {},
): Promise<void> {
  let respond = async (status: number, body: unknown) =>
    await setContextResponse(
      ctxt,
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': SupportedMimeType.CardJson },
      }),
    );
  if (named.length !== 1) {
    await respond(
      400,
      buildSearchErrorBody(
        "Invalid query: a log search runs on one realm's _search, so realms names exactly one realm",
        400,
        'invalid-value',
      ),
    );
    return;
  }
  let [realm] = named;
  let { realms: _realms, ...query } = payload as LogQuery & {
    realms?: unknown;
  };
  let readsRealm = readable.includes(realm);
  let viaPolicy = !readsRealm && (opts.grantCandidates ?? []).includes(realm);
  if (!readsRealm && !viaPolicy) {
    await respond(
      403,
      buildSearchErrorBody(NOT_READABLE, 403, 'log-not-readable'),
    );
    return;
  }
  let mounted = opts.realmFor?.(realm);
  if (mounted) {
    let { status, body } = await mounted.searchLogLines(query as LogQuery, {
      readsRealm,
      ...(opts.user ? { user: opts.user } : {}),
    });
    await respond(status, body);
    return;
  }
  if (!readsRealm) {
    // Only the realm can say what its policy grants on its lines.
    await respond(
      403,
      buildSearchErrorBody(NOT_READABLE, 403, 'log-not-readable'),
    );
    return;
  }
  let { status, body } = await logSearchResponse(
    dbAdapter,
    realm,
    query as LogQuery,
  );
  await respond(status, body);
}
