import { ensureTrailingSlash } from './paths';
import {
  assertQuery,
  InvalidQueryError,
  parseQuery,
  type Query,
} from './query';
import type { CardCollectionDocument } from './document-types';
import { SupportedMimeType } from './router';

export type SearchRequestErrorCode =
  | 'missing-realms'
  | 'missing-query'
  | 'invalid-json'
  | 'unsupported-method'
  | 'invalid-query';

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
  let method = resolveSearchRequestMethod(request);
  let cardsQuery: unknown;

  if (method === 'QUERY') {
    try {
      cardsQuery = await request.json();
    } catch (e: any) {
      throw new SearchRequestError(
        'invalid-json',
        `Request body is not valid JSON: ${e?.message ?? e}`,
      );
    }
  } else if (method === 'GET') {
    let url = new URL(request.url);
    let queryParam = url.searchParams.get('query');
    if (!queryParam) {
      throw new SearchRequestError(
        'missing-query',
        'query param "query" must be supplied',
      );
    }
    cardsQuery = parseQuery(queryParam);
  } else {
    throw new SearchRequestError(
      'unsupported-method',
      'method must be QUERY or GET',
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

  return cardsQuery as Query;
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
