import merge from 'lodash/merge';

const cache = new Map<string, { etag: string; body: string }>();

// we need to be careful not to read the response stream before the intended
// consumer has read it. so we use this callback to allow the consumer to set
// the cached response with the body after they have first had a chance to read
// it.
export type MaybeCachedResponse = Response & {
  cacheResponse?: (body: string) => void;
};

export async function cachedFetch(
  fetchImplementation: typeof globalThis.fetch,
  urlOrRequest: string | URL | Request,
  init?: RequestInit,
): Promise<MaybeCachedResponse> {
  let key =
    typeof urlOrRequest === 'string'
      ? urlOrRequest
      : urlOrRequest instanceof URL
        ? urlOrRequest.href
        : urlOrRequest.url;
  let cached = cache.get(key);
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
        `Received HTTP 304 "not modified" when we don't have cache for ${key}`,
      );
    }
    return new Response(cached.body);
  } else if (response.ok) {
    let maybeETag = response.headers.get('ETag');

    if (maybeETag) {
      let etag = maybeETag;
      response.cacheResponse = (body: string) => {
        cache.set(key, { etag, body });
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
