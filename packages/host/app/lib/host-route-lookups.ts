import {
  hostRouteLookups,
  type HostRouteLoad,
  type HostRouteSearch,
  type VirtualNetwork,
} from '@cardstack/runtime-common';

// A host route lookup the realm refused or failed to answer: a rate limit,
// a refused search, a server error, a body that can't be read, a request
// that never got an answer. The resolver stops on it, and the page shows an
// error state, never the not-found page. `status` is the realm's answer,
// when the failure is its status.
export class HostRouteLookupError extends Error {
  status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'HostRouteLookupError';
    this.status = status;
  }
}

// The `load` and `search` the host route resolver runs in the browser: the
// shared `hostRouteLookups`, sending each request to the routing realm
// through the app's own fetch, the one the store uses, so it runs as the
// visitor. The realm server reads the answers with the same rules.
export function visitorHostRouteLookups({
  fetch,
  virtualNetwork,
  realmURL,
}: {
  fetch: typeof globalThis.fetch;
  virtualNetwork: VirtualNetwork;
  // The URL the routing realm is served at, ending with `/`.
  realmURL: string;
}): { load: HostRouteLoad; search: HostRouteSearch } {
  return hostRouteLookups({
    realmURL,
    virtualNetwork,
    send: async (request) => {
      try {
        return await fetch(request);
      } catch (e) {
        throw new HostRouteLookupError(
          `a host route lookup of ${request.url} failed: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    },
    lookupError: (message, response) =>
      new HostRouteLookupError(message, response?.status),
  });
}
