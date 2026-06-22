import type { RealmResourceIdentifier } from './realm-identifiers.ts';
import { logger } from './log.ts';
import { resourceIdentity } from './resource-types.ts';
import { ensureTrailingSlash } from './paths.ts';
import { assertQuery, InvalidQueryError, type Query } from './query.ts';
import { RequestTimings } from './request-timings.ts';
import {
  isValidPrerenderedHtmlFormat,
  PRERENDERED_HTML_FORMATS,
  type PrerenderedHtmlFormat,
} from './prerendered-html-format.ts';
import type {
  PrerenderedCardCollectionDocument,
  LinkableCollectionDocument,
} from './document-types.ts';
import { SupportedMimeType } from './router.ts';

export type SearchRequestErrorCode =
  | 'missing-realms'
  | 'invalid-json'
  | 'unsupported-method'
  | 'invalid-query'
  | 'invalid-render'
  | 'invalid-prerendered-html-format';

type PrerenderedRenderType = {
  module: RealmResourceIdentifier;
  name: string;
};

export class SearchRequestError extends Error {
  code: SearchRequestErrorCode;

  constructor(code: SearchRequestErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'SearchRequestError';
  }
}

function normalizeStringParam(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === 'string'
  ) {
    return value[0];
  }
  return undefined;
}

function normalizeStringArrayParam(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    if (!value.every((entry) => typeof entry === 'string')) {
      return undefined;
    }
    return value;
  }
  if (typeof value === 'string') {
    return [value];
  }
  return undefined;
}

function normalizeRenderType(
  value: unknown,
): PrerenderedRenderType | undefined {
  if (
    value &&
    typeof value === 'object' &&
    'module' in value &&
    'name' in value
  ) {
    let { module, name } = value as { module?: unknown; name?: unknown };
    if (typeof module === 'string' && typeof name === 'string') {
      return { module: module as RealmResourceIdentifier, name };
    }
  }
  return undefined;
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

export async function parseSearchQueryFromRequest(
  request: Request,
): Promise<Query> {
  let payload = await parseSearchRequestPayload(request);
  return parseSearchQueryFromPayload(payload);
}

export function parseSearchQueryFromPayload(payload: unknown): Query {
  let cardsQuery = payload;
  try {
    assertQuery(cardsQuery);
  } catch (e) {
    if (e instanceof InvalidQueryError) {
      throw new SearchRequestError(
        'invalid-query',
        `Invalid query: ${e.message}`,
      );
    }
    throw e;
  }

  return cardsQuery as Query;
}

export async function parsePrerenderedSearchRequestFromRequest(
  request: Request,
): Promise<{
  cardsQuery: Query;
  htmlFormat: PrerenderedHtmlFormat;
  cardUrls?: string[];
  renderType?: PrerenderedRenderType;
}> {
  let payload = await parseSearchRequestPayload(request);
  return parsePrerenderedSearchRequestFromPayload(payload);
}

export function parsePrerenderedSearchRequestFromPayload(payload: unknown): {
  cardsQuery: Query;
  htmlFormat: PrerenderedHtmlFormat;
  cardUrls?: string[];
  renderType?: PrerenderedRenderType;
} {
  let cardsQuery: unknown;
  let htmlFormat: string | undefined;
  let cardUrls: string[] | undefined;
  let renderType: PrerenderedRenderType | undefined;

  let payloadRecord =
    payload && typeof payload === 'object'
      ? (payload as Record<string, any>)
      : {};
  htmlFormat = normalizeStringParam(payloadRecord.prerenderedHtmlFormat);
  let hasCardUrls = 'cardUrls' in payloadRecord;
  cardUrls = normalizeStringArrayParam(payloadRecord.cardUrls);
  if (hasCardUrls && !cardUrls) {
    throw new SearchRequestError(
      'invalid-query',
      'cardUrls must be a string or array of strings',
    );
  }
  renderType = normalizeRenderType(payloadRecord.renderType);
  let {
    prerenderedHtmlFormat: _remove1,
    cardUrls: _remove2,
    renderType: _remove3,
    ...rest
  } = payloadRecord;
  cardsQuery = rest;

  if (!isValidPrerenderedHtmlFormat(htmlFormat)) {
    throw new SearchRequestError(
      'invalid-prerendered-html-format',
      `Must include a 'prerenderedHtmlFormat' parameter with a value of ${PRERENDERED_HTML_FORMATS.join(', ')} to use this endpoint`,
    );
  }

  try {
    assertQuery(cardsQuery);
  } catch (e) {
    if (e instanceof InvalidQueryError) {
      throw new SearchRequestError(
        'invalid-query',
        `Invalid query: ${e.message}`,
      );
    }
    throw e;
  }

  return {
    cardsQuery: cardsQuery as Query,
    htmlFormat,
    cardUrls,
    renderType,
  };
}

// The federated merge: concatenate `data` in realm order, sum
// `meta.page.total`, and dedupe `included` by the JSON:API identity pair
// `(type, id)`. The `included` holds transitively-linked `card` / `file-meta`
// resources, so a linked card referenced by results from more than one realm
// travels exactly once.
export function combineSearchResults(
  docs: LinkableCollectionDocument[],
): LinkableCollectionDocument {
  let combined: LinkableCollectionDocument = {
    data: [],
    meta: { page: { total: 0 } },
  };
  let included: NonNullable<LinkableCollectionDocument['included']> = [];
  let includedByIdentity = new Set<string>();

  for (let doc of docs) {
    combined.data.push(...doc.data);
    combined.meta.page.total += doc.meta?.page?.total ?? 0;
    if (doc.included) {
      for (let resource of doc.included) {
        if (resource.id) {
          // NUL-separated so a `(type, id)` pair can't alias another by
          // concatenation (no resource type or id contains a NUL byte).
          let identity = resourceIdentity(resource.type, resource.id);
          if (includedByIdentity.has(identity)) {
            continue;
          }
          includedByIdentity.add(identity);
        }
        included.push(resource);
      }
    }
  }

  if (included.length > 0) {
    combined.included = included;
  }

  return combined;
}

// Merges results into the prerendered-card document shape: CSS folds into a
// flat `meta.scopedCssUrls` Set and "is this a file?" rides in
// `meta.isFileMeta`. This contrasts with `combineSearchResults`, where CSS is a
// first-class `css` resource deduped inside `included` and the resource `type`
// distinguishes a card from a file.
export function combinePrerenderedSearchResults(
  docs: PrerenderedCardCollectionDocument[],
): PrerenderedCardCollectionDocument {
  let combined: PrerenderedCardCollectionDocument = {
    data: [],
    meta: { page: { total: 0 } },
  };
  let scopedCssUrls = new Set<string>();

  for (let doc of docs) {
    combined.data.push(...doc.data);
    combined.meta.page.total += doc.meta?.page?.total ?? 0;
    for (let url of doc.meta?.scopedCssUrls ?? []) {
      scopedCssUrls.add(url);
    }
  }

  if (scopedCssUrls.size > 0) {
    combined.meta.scopedCssUrls = [...scopedCssUrls];
  }
  if (docs.length === 1 && docs[0]?.meta?.realmInfo) {
    combined.meta.realmInfo = docs[0].meta.realmInfo;
  }
  if (docs.some((doc) => doc.meta?.isFileMeta)) {
    combined.meta.isFileMeta = true;
  }

  return combined;
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
};

type SearchableRealm = {
  search: (
    query: Query,
    opts?: SearchOpts,
  ) => Promise<LinkableCollectionDocument>;
  url?: string;
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

export async function searchRealms(
  realms: Array<SearchableRealm | null | undefined>,
  query: Query,
  opts?: SearchOpts,
): Promise<LinkableCollectionDocument> {
  // Instrument only when the caller threaded a correlation id. The
  // prerendered host stamps one; live SPA / API traffic does not — so
  // normal traffic allocates no collector and emits no line.
  //
  // Two callers: the realm-server's `handle-search` threads a collector it
  // owns (so it can emit one complete request→response line itself —
  // `opts.timings` is set, `ownsTimings` is false, we don't emit), and the
  // host-test realm-server mock calls us with just a `loggingCorrelationId` (we create
  // the collector and emit the line ourselves, which the host test observes).
  let ownsTimings = Boolean(opts?.loggingCorrelationId) && !opts?.timings;
  let timings =
    opts?.timings ?? (ownsTimings ? new RequestTimings() : undefined);
  let perRealmOpts = ownsTimings && opts ? { ...opts, timings } : opts;
  let startedAt = ownsTimings ? Date.now() : 0;
  let docs = await fanOutRealmSearch(
    realms,
    query,
    (realm) => realm.search(query, perRealmOpts),
    (label, queryLabel) =>
      `searchRealms realm search failed: ${label} query=${queryLabel}`,
  );
  // `realm.search` returns the live-card document; the merge concatenates
  // `data` and dedupes `included` by `(type, id)`.
  let combined = combineSearchResults(docs);
  if (timings) {
    timings.incr('results', combined.data?.length ?? 0);
  }
  if (ownsTimings && timings) {
    emitSearchTiming(
      `corr=${opts!.loggingCorrelationId}` +
        ` realms=${realms.filter((realm) => Boolean(realm)).length}` +
        ` total=${Date.now() - startedAt}ms ` +
        timings.toLogFragment(),
    );
  }
  return combined;
}

type PrerenderedSearchableRealm = {
  searchPrerendered: (
    query: Query,
    opts: {
      htmlFormat: PrerenderedHtmlFormat;
      cardUrls?: string[];
      renderType?: PrerenderedRenderType;
    },
  ) => Promise<PrerenderedCardCollectionDocument>;
  url?: string;
};

export async function searchPrerenderedRealms(
  realms: Array<PrerenderedSearchableRealm | null | undefined>,
  query: Query,
  opts: {
    htmlFormat: PrerenderedHtmlFormat;
    cardUrls?: string[];
    renderType?: PrerenderedRenderType;
  },
): Promise<PrerenderedCardCollectionDocument> {
  let docs = await fanOutRealmSearch(
    realms,
    query,
    (realm) => realm.searchPrerendered(query, opts),
    (label, queryLabel) =>
      `searchPrerenderedRealms realm search failed: ${label} query=${queryLabel} htmlFormat=${opts.htmlFormat}`,
  );
  return combinePrerenderedSearchResults(docs);
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
