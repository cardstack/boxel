import { logger } from './log.ts';
import { ensureTrailingSlash } from './paths.ts';
import type { Query } from './query.ts';
import type { RequestTimings } from './request-timings.ts';
import { SupportedMimeType } from './router.ts';

export type SearchRequestErrorCode =
  | 'missing-realms'
  | 'invalid-json'
  | 'unsupported-method'
  | 'invalid-query'
  | 'invalid-render'
  | 'invalid-prerendered-html-format';

export class SearchRequestError extends Error {
  code: SearchRequestErrorCode;

  constructor(code: SearchRequestErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'SearchRequestError';
  }
}

export function parseRealmsParam(url: URL): string[] {
  return url.searchParams
    .getAll('realms')
    .flatMap((value) => value.split(','))
    .map((realm) => realm.trim())
    .filter(Boolean)
    .map((realm) => ensureTrailingSlash(realm));
}

export async function parseSearchRequestPayload(
  request: Request,
): Promise<unknown> {
  let method = resolveSearchRequestMethod(request);
  if (method !== 'QUERY') {
    throw new SearchRequestError('unsupported-method', 'method must be QUERY');
  }

  try {
    return await request.json();
  } catch (e: any) {
    throw new SearchRequestError(
      'invalid-json',
      `Request body is not valid JSON: ${e?.message ?? e}`,
    );
  }
}

export function parseRealmsFromPayload(payload: unknown): string[] {
  let payloadRecord =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : {};
  if (
    !('realms' in payloadRecord) ||
    (Array.isArray(payloadRecord.realms) &&
      payloadRecord.realms.map((realm) => realm.trim()).filter(Boolean)
        .length == 0)
  ) {
    throw new SearchRequestError(
      'missing-realms',
      'realms must be supplied in request body',
    );
  }
  let realmsValue = payloadRecord.realms;
  if (
    !Array.isArray(realmsValue) ||
    !realmsValue.every((realm) => typeof realm === 'string')
  ) {
    throw new SearchRequestError(
      'missing-realms',
      'realms must be an array of strings',
    );
  }
  let realmList = realmsValue
    .map((realm) => realm.trim())
    .filter(Boolean)
    .map((realm) => ensureTrailingSlash(realm));
  return realmList;
}

export async function parseRealmsFromRequest(
  request: Request,
): Promise<string[]> {
  let payload = await parseSearchRequestPayload(request);
  return parseRealmsFromPayload(payload);
}

export function resolveSearchRequestMethod(request: Request): string {
  let method = request.method.toUpperCase();
  if (method === 'POST') {
    // used for tests, supertest does not support HTTP QUERY
    let override = request.headers.get('x-http-method-override');
    if (override && override.toUpperCase() === 'QUERY') {
      return 'QUERY';
    }
  }
  return method;
}

// Shared opts contract for the federated-search path, kept in one place so
// SearchableRealm.search, searchRealms, and Realm.search can't drift —
// dropping a field here (e.g. priority) silently breaks the threading from
// the realm-server handler down to searchCards.
export type SearchOpts = {
  cacheOnlyDefinitions?: boolean;
  // Prerender searches set this so `searchCardsUncoalesced` skips the
  // `loadLinks` relationship-assembly pass entirely (the host re-resolves
  // every result from card+source and reads only `data[].id`). Live /
  // external callers leave it unset and receive fully-assembled documents.
  omitIncluded?: boolean;
  priority?: number;
  // Correlation id minted by the client (the prerendered host stamps
  // `x-boxel-logging-correlation-id` on its `_federated-search` fetch) and read back
  // out by the request handler into opts. When present, `searchRealms`
  // instruments the server-side search pipeline and emits one
  // `realm:search-timing` line keyed by this id, so a client-observed
  // slow search can be joined to where the realm-server spent the time.
  loggingCorrelationId?: string;
  // Per-request wall-clock collector. `searchRealms` creates it when a
  // `loggingCorrelationId` is present and threads it down through `Realm.search` →
  // `searchCards` → `loadLinks` so each post-SQL stage stamps its
  // elapsed time. Callers never supply this directly.
  timings?: RequestTimings;
  // Restrict the result set to this subset of card URLs. The query engine
  // applies it as a SQL `i.url IN (...)` filter, so it must reach the engine
  // opts — not only the cache key — for the subset to actually narrow results.
  cardUrls?: string[];
  // Cooperative-cancellation signal for the per-request time budget. When the
  // search handler cuts an over-budget item-leg search off, this aborts so the
  // engine's `loadLinks` fan-out stops promptly instead of running to
  // completion. Threaded the same way as `timings`.
  signal?: AbortSignal;
};

// Indirection so a host integration test can deterministically capture
// the emitted timing line: loglevel rebinds a logger's methods on every
// `setLevel`, so a test that monkeypatches a direct logger handle would
// race the next `logger('realm:search-timing')` call. A settable sink
// sidesteps that. Defaults to the `realm:search-timing` logger.
let searchTimingSink: ((line: string) => void) | undefined;
let searchTimingLog: ReturnType<typeof logger> | undefined;
export function setSearchTimingSinkForTests(
  sink: ((line: string) => void) | undefined,
): void {
  searchTimingSink = sink;
}
export function emitSearchTiming(line: string): void {
  if (searchTimingSink) {
    searchTimingSink(line);
    return;
  }
  // Lazy: a module-load `logger()` call races the circular import that
  // installs the logger factory. First emission happens well after boot.
  (searchTimingLog ??= logger('realm:search-timing')).info(line);
}

// Shared fan-out for the federated search runners. Filters out dead realms,
// runs each surviving realm's search concurrently, logs (never throws on) a
// per-realm failure so one realm can't sink the whole federation, and returns
// the fulfilled docs in input order for the caller to merge. The two public
// runners differ only in which per-realm method they call, how they label a
// failure, and which merge they apply — the settle semantics, input ordering,
// and per-realm error isolation are identical and live here.
export async function fanOutRealmSearch<R extends { url?: string }, Doc>(
  realms: Array<R | null | undefined>,
  query: Query,
  call: (realm: R) => Promise<Doc>,
  describeFailure: (label: string, queryLabel: string) => string,
): Promise<Doc[]> {
  let realmEntries = realms
    .filter((realm): realm is R => Boolean(realm))
    .map((realm) => ({
      realm,
      label: realm.url ? String(realm.url) : undefined,
    }));
  let searchPromises = realmEntries.map(({ realm }) =>
    Promise.resolve().then(() => call(realm)),
  );
  let results = await Promise.allSettled(searchPromises);
  let queryLabel = '[unserializable query]';
  try {
    queryLabel = JSON.stringify(query);
  } catch {
    // ignore stringify errors, fallback label already set
  }
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      let label = realmEntries[index]?.label ?? `index ${index}`;
      console.error(describeFailure(label, queryLabel), result.reason);
    }
  });
  return results.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
}

export type SearchErrorBody = {
  errors: { status: string; title: string; message: string }[];
};

export function buildSearchErrorBody(
  message: string,
  status = 400,
): SearchErrorBody {
  return {
    errors: [
      {
        status: String(status),
        title: 'Invalid Query',
        message,
      },
    ],
  };
}

export function buildSearchErrorResponse(
  message: string,
  status = 400,
): Response {
  return new Response(JSON.stringify(buildSearchErrorBody(message, status)), {
    status,
    headers: { 'content-type': SupportedMimeType.CardJson },
  });
}
