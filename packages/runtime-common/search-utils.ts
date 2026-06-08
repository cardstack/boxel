import type { RealmResourceIdentifier } from './realm-identifiers';
import { logger } from './log';
import { ensureTrailingSlash } from './paths';
import { assertQuery, InvalidQueryError, type Query } from './query';
import { RequestTimings } from './request-timings';
import {
  isValidPrerenderedHtmlFormat,
  PRERENDERED_HTML_FORMATS,
  type PrerenderedHtmlFormat,
} from './prerendered-html-format';
import { type Format, formats, isValidFormat } from './formats';
import type { CodeRef } from './code-ref';
import { isCodeRef } from './card-document-shape';
import type {
  LinkableCollectionDocument,
  PrerenderedCardCollectionDocument,
} from './document-types';
import { SupportedMimeType } from './router';

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

// ---------------------------------------------------------------------------
// Unified search request (the /_search + /_federated-search request body).
//
// On top of the query (filter / sort / page / realms), the body grows two
// optional members — `render` (how to render the preferred HTML) and
// `dataOnly` (opt-in live-cards-only) — plus `cardUrls` (promoted from the
// prerendered opts). Prefer-HTML is the DEFAULT: a missing `render` is NOT
// read as data-only; `dataOnly: true` is the only way to get live-only.
// ---------------------------------------------------------------------------

// `render.renderType`: an explicit CodeRef to render every result as, or the
// literal "native" escape valve (each result in its own most-derived type).
// Omitted → the searched `filter.on` common-ancestor type (resolved by the
// server).
export type SearchRenderType = CodeRef | 'native';

export interface SearchRenderSpec {
  // The format to render; defaults to "fitted" when the caller omits it.
  format: Format;
  renderType?: SearchRenderType;
}

export interface UnifiedSearchOpts {
  // The prefer-HTML rendering spec. Present unless `dataOnly` is set.
  render?: SearchRenderSpec;
  // Opt-in live-cards-only (e.g. boxel-cli): full cards, never HTML.
  dataOnly?: boolean;
  cardUrls?: string[];
}

export interface UnifiedSearchRequest extends UnifiedSearchOpts {
  cardsQuery: Query;
}

export const DEFAULT_RENDER_FORMAT: Format = 'fitted';

function normalizeRenderSpec(value: unknown): SearchRenderSpec {
  let spec: SearchRenderSpec = { format: DEFAULT_RENDER_FORMAT };
  if (value === undefined) {
    return spec;
  }
  if (typeof value !== 'object' || value === null) {
    throw new SearchRequestError('invalid-render', 'render must be an object');
  }
  let { format, renderType } = value as {
    format?: unknown;
    renderType?: unknown;
  };
  if (format !== undefined) {
    if (typeof format !== 'string' || !isValidFormat(format)) {
      throw new SearchRequestError(
        'invalid-render',
        `render.format must be one of ${formats.join(', ')}`,
      );
    }
    spec.format = format;
  }
  if (renderType !== undefined) {
    if (renderType === 'native') {
      spec.renderType = 'native';
    } else if (isCodeRef(renderType)) {
      spec.renderType = renderType;
    } else {
      throw new SearchRequestError(
        'invalid-render',
        'render.renderType must be a CodeRef or "native"',
      );
    }
  }
  return spec;
}

export async function parseUnifiedSearchRequestFromRequest(
  request: Request,
): Promise<UnifiedSearchRequest> {
  let payload = await parseSearchRequestPayload(request);
  return parseUnifiedSearchRequestFromPayload(payload);
}

export function parseUnifiedSearchRequestFromPayload(
  payload: unknown,
): UnifiedSearchRequest {
  // Reject a non-object body (null / string / number / boolean) rather than
  // coercing it to `{}` and treating it as an empty broad search — matching
  // the live parser, which passes such payloads straight to `assertQuery`.
  if (payload == null || typeof payload !== 'object') {
    throw new SearchRequestError(
      'invalid-query',
      'Invalid query: request body must be a JSON object',
    );
  }
  let payloadRecord = payload as Record<string, any>;

  // `dataOnly: true` is the only way to get live-only results; anything else
  // (including a missing `render`) keeps the prefer-HTML default.
  let dataOnly = payloadRecord.dataOnly === true;

  let hasCardUrls = 'cardUrls' in payloadRecord;
  let cardUrls = normalizeStringArrayParam(payloadRecord.cardUrls);
  if (hasCardUrls && !cardUrls) {
    throw new SearchRequestError(
      'invalid-query',
      'cardUrls must be a string or array of strings',
    );
  }

  // Materialize the prefer-HTML spec (format defaulting to "fitted") whenever
  // the caller hasn't opted into data-only — so a request with no `render` is
  // prefer-HTML/fitted, not live-only.
  let render = dataOnly ? undefined : normalizeRenderSpec(payloadRecord.render);

  let {
    render: _remove1,
    dataOnly: _remove2,
    cardUrls: _remove3,
    ...rest
  } = payloadRecord;
  let cardsQuery: unknown = rest;

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
    render,
    dataOnly,
    cardUrls,
  };
}

export function combineSearchResults(
  docs: LinkableCollectionDocument[],
): LinkableCollectionDocument {
  let combined: LinkableCollectionDocument = {
    data: [],
    meta: { page: { total: 0 } },
  };
  let included: NonNullable<LinkableCollectionDocument['included']> = [];
  let includedById = new Set<string>();

  for (let doc of docs) {
    combined.data.push(...doc.data);
    combined.meta.page.total += doc.meta?.page?.total ?? 0;
    if (doc.included) {
      for (let resource of doc.included) {
        if (resource.id) {
          if (includedById.has(resource.id)) {
            continue;
          }
          includedById.add(resource.id);
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
  let realmEntries = realms
    .filter((realm): realm is SearchableRealm => Boolean(realm))
    .map((realm) => ({
      realm,
      label: realm.url ? String(realm.url) : undefined,
    }));
  let searchPromises = realmEntries.map(({ realm }) =>
    Promise.resolve().then(() => realm.search(query, perRealmOpts)),
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
      console.error(
        `searchRealms realm search failed: ${label} query=${queryLabel}`,
        result.reason,
      );
    }
  });
  let docs = results.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
  let combined = combineSearchResults(docs);
  if (timings) {
    timings.incr('results', combined.data?.length ?? 0);
  }
  if (ownsTimings && timings) {
    emitSearchTiming(
      `corr=${opts!.loggingCorrelationId}` +
        ` realms=${realmEntries.length}` +
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
  let realmEntries = realms
    .filter((realm): realm is PrerenderedSearchableRealm => Boolean(realm))
    .map((realm) => ({
      realm,
      label: realm.url ? String(realm.url) : undefined,
    }));
  let searchPromises = realmEntries.map(({ realm }) =>
    Promise.resolve().then(() => realm.searchPrerendered(query, opts)),
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
      console.error(
        `searchPrerenderedRealms realm search failed: ${label} query=${queryLabel} htmlFormat=${opts.htmlFormat}`,
        result.reason,
      );
    }
  });
  let docs = results.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
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
