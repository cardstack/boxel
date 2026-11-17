import type {
  HostRouteLoad,
  HostRouteSearch,
  Realm,
} from '@cardstack/runtime-common';
import {
  CLIENT_CLASS_HEADER,
  CLIENT_IP_HEADER,
  hostRouteLookups,
} from '@cardstack/runtime-common';
import { SEARCH_SHED_RETRY_AFTER_SECONDS } from '../middleware/index.ts';
import {
  admitSearch,
  beginSearchRequest,
  type SearchRequest,
} from '../search-inflight.ts';

// A host route lookup the realm refused or failed to answer. `status` is the
// status the page answers with: 429 when the realm rate-limited the visitor or
// the server's search ceiling shed the search, 503 for anything else. `retryAfter` is the realm's `Retry-After`, when it
// sent one.
export class HostRouteLookupError extends Error {
  status: 429 | 503;
  retryAfter: string | undefined;
  constructor(message: string, status: 429 | 503, retryAfter?: string) {
    super(message);
    this.name = 'HostRouteLookupError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

// The `load` and `search` the host route resolver runs for a page request.
// Each one is a request to the realm's own handler, built as the visitor's
// request would be: no credentials of its own, and the visitor's address
// headers, so the realm admits, limits and refuses it exactly as it would the
// visitor's own card request or search. Visitors on host URLs are anonymous.
// The request goes to the realm in-process, past the server's middleware, so
// the search takes its slot under the server's in-flight search ceiling here,
// as an HTTP search does in the admission middleware.
//
// A card the visitor may not read (401, 403), a card that isn't there (404)
// and an address that holds a file other than a card are misses: the
// resolver goes on to the next route. A search the realm
// refuses (401, 403) is not a card the visitor can't read but a visitor the
// realm turns away, so it is an error, as is every other failure. A rate limit
// or a search the ceiling sheds answers 429, and any other error 503, rather
// than a not-found page.
//
// Card ids and links come back as the realm writes them, which can be a
// prefix-form identifier or a relative link; each is turned into the served
// URL the resolver compares (`HostRouteCard`).
export function visitorHostRouteLookups({
  realm,
  visitorHeaders,
}: {
  realm: Realm;
  // The headers of the page request.
  visitorHeaders: Record<string, string | string[] | undefined>;
}): { load: HostRouteLoad; search: HostRouteSearch } {
  let headers: Record<string, string> = {};
  for (let name of [CLIENT_IP_HEADER, CLIENT_CLASS_HEADER]) {
    let value = visitorHeaders[name];
    if (typeof value === 'string') {
      headers[name] = value;
    }
  }
  return hostRouteLookups({
    realmURL: realm.url,
    virtualNetwork: realm.virtualNetwork,
    headers,
    send: async (request) => (await realm.handle(request)) ?? undefined,
    withSearchSlot: async (run) => {
      let release = await admitSearch();
      if (!release) {
        throw new HostRouteLookupError(
          `the server's search ceiling shed a host route search in ${realm.url}`,
          429,
          String(SEARCH_SHED_RETRY_AFTER_SECONDS),
        );
      }
      let searchRequest: SearchRequest | undefined;
      try {
        searchRequest = beginSearchRequest();
        searchRequest.attribute([realm.url]);
        return await run();
      } finally {
        release();
        searchRequest?.end();
      }
    },
    lookupError: (message, response) =>
      response?.status === 429
        ? new HostRouteLookupError(
            message,
            429,
            response.headers.get('Retry-After') ?? undefined,
          )
        : new HostRouteLookupError(message, 503),
  });
}
