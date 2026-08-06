import { merge } from 'lodash-es';

import { baseRealm, isNode } from './index.ts';

const cache = new Map<
  string,
  { etag: string; body: string; realmURL: string }
>();

// When set, cached base-realm responses are served without revalidating, and
// they survive `clearFetchCache`.
//
// Every entry here still costs a request otherwise: the cache is
// revalidation-based (`If-None-Match` → 304), and the realm serves modules
// `max-age=0`, so a cache hit saves the body but not the round trip. That is
// the right default for the running app, where a realm's contents can change
// under it. It is the wrong one for a test suite: the base realm is
// read-only and fixed for the lifetime of the page, while the loader is
// replaced constantly (per test, and on every reset), and each replacement
// re-requests the whole base module graph — a single test can re-request
// `base/card-api` ten times.
//
// Only the base realm qualifies, and only because it is world-readable: the
// cache is cleared between tests so one test's realm contents can't leak
// into another's, and keeping public, immutable modules doesn't weaken that.
let serveBaseRealmFromCacheWithoutRevalidating = false;

export function trustBaseRealmFetchCache(trusted = true) {
  serveBaseRealmFromCacheWithoutRevalidating = trusted;
}

function isTrustedBaseRealmEntry(entry: { realmURL: string } | undefined) {
  return (
    serveBaseRealmFromCacheWithoutRevalidating &&
    entry?.realmURL === baseRealm.url
  );
}

// we need to be careful not to read the response stream before the intended
// consumer has read it. so we use this callback to allow the consumer to set
// the cached response with the body after they have first had a chance to read
// it.
export type MaybeCachedResponse = Response & {
  cacheResponse?: (body: string) => void;
};

function getAcceptHeader(
  urlOrRequest: string | URL | Request,
  init?: RequestInit,
): string {
  if (urlOrRequest instanceof Request) {
    return urlOrRequest.headers.get('Accept') ?? '*/*';
  }
  if (init?.headers) {
    let headers = new Headers(init.headers as HeadersInit);
    return headers.get('Accept') ?? '*/*';
  }
  return '*/*';
}

export async function cachedFetch(
  fetchImplementation: typeof globalThis.fetch,
  urlOrRequest: string | URL | Request,
  init?: RequestInit,
): Promise<MaybeCachedResponse> {
  if (isNode) {
    // we don't have the necessary isolation to cache safely with module scoped
    // cache on the server and during indexing
    return fetchImplementation(urlOrRequest, init);
  }

  let key =
    typeof urlOrRequest === 'string'
      ? urlOrRequest
      : urlOrRequest instanceof URL
        ? urlOrRequest.href
        : urlOrRequest.url;
  let accept = getAcceptHeader(urlOrRequest, init).trim().toLowerCase();
  let cacheKey = `${key}::accept:${accept}`;
  let cached = cache.get(cacheKey);
  if (cached && isTrustedBaseRealmEntry(cached)) {
    // Same shape the 304 branch below returns, which every consumer of this
    // function already handles.
    return new Response(cached.body);
  }
  if (cached?.etag) {
    if (urlOrRequest instanceof Request) {
      urlOrRequest.headers.set('If-None-Match', cached.etag);
    } else {
      init = merge(init ?? {}, {
        headers: {
          'If-None-Match': cached.etag,
        },
      });
    }
  }
  let response = (await fetchImplementation(
    urlOrRequest,
    init,
  )) as MaybeCachedResponse;
  if (response.status === 304) {
    if (!cached) {
      throw new Error(
        `Received HTTP 304 "not modified" when we don't have cache for ${key} (Accept: ${accept})`,
      );
    }
    return new Response(cached.body);
  } else if (response.ok) {
    let maybeETag = response.headers.get('ETag');
    let maybeRealmURL = response.headers.get('X-boxel-realm-url');
    if (maybeETag && maybeRealmURL) {
      let etag = maybeETag;
      let realmURL = maybeRealmURL;
      response.cacheResponse = (body: string) => {
        cache.set(cacheKey, { etag, body, realmURL });
      };
    }
  }
  return response;
}

// make sure to clear this between tests so that cache contents don't leak
// outside each test. Base-realm entries are kept when they have been marked
// trusted (see trustBaseRealmFetchCache) — they are public and, for the
// lifetime of that page, immutable.
export function clearFetchCache() {
  for (let [key, entry] of cache) {
    if (!isTrustedBaseRealmEntry(entry)) {
      cache.delete(key);
    }
  }
}
