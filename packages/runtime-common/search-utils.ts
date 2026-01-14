import { ensureTrailingSlash } from './paths';
import { assertQuery, InvalidQueryError, type Query } from './query';
import {
  isValidPrerenderedHtmlFormat,
  type PrerenderedHtmlFormat,
} from './prerendered-html-format';
import type {
  CardCollectionDocument,
  PrerenderedCardCollectionDocument,
} from './document-types';
import { SupportedMimeType } from './router';

export type SearchRequestErrorCode =
  | 'missing-realms'
  | 'invalid-json'
  | 'unsupported-method'
  | 'invalid-query'
  | 'invalid-prerendered-html-format';

type PrerenderedRenderType = {
  module: string;
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
    return value.map((entry) => String(entry));
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
      return { module, name };
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
  cardUrls = normalizeStringArrayParam(payloadRecord.cardUrls);
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
      "Must include a 'prerenderedHtmlFormat' parameter with a value of 'embedded', 'fitted', 'atom', or 'head' to use this endpoint",
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

export function combineSearchResults(
  docs: CardCollectionDocument[],
): CardCollectionDocument {
  let combined: CardCollectionDocument = {
    data: [],
    meta: { page: { total: 0 } },
  };
  let included: NonNullable<CardCollectionDocument['included']> = [];
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

  return combined;
}

type SearchableRealm = {
  search: (query: Query) => Promise<CardCollectionDocument>;
  url?: string;
};

export async function searchRealms(
  realms: Array<SearchableRealm | null | undefined>,
  query: Query,
): Promise<CardCollectionDocument> {
  let realmEntries = realms
    .filter((realm): realm is SearchableRealm => Boolean(realm))
    .map((realm) => ({
      realm,
      label: realm.url ? String(realm.url) : undefined,
    }));
  let searchPromises = realmEntries.map(({ realm }) =>
    Promise.resolve().then(() => realm.search(query)),
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
  return combineSearchResults(docs);
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
