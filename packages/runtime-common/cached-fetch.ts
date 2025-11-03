import merge from 'lodash/merge';

import { isNode } from './index';

const cache = new Map<string, { etag: string; body: string }>();
const isFastBoot = typeof (globalThis as any).FastBoot !== 'undefined';

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
  if (isNode || isFastBoot) {
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
      response.cacheResponse = (body: string) => {
        cache.set(cacheKey, { etag, body });
      };
    }
  }
  return response;
}

// make sure to clear this between tests so that cache contents don't leak
// outside each test
export function clearFetchCache() {
  cache.clear();
}
