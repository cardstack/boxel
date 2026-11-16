import type {
  HostRouteCard,
  HostRouteLoad,
  HostRouteSearch,
  Realm,
} from '@cardstack/runtime-common';
import {
  CLIENT_CLASS_HEADER,
  CLIENT_IP_HEADER,
  SupportedMimeType,
  isEntryCollectionDocument,
  searchEntryWireQueryFromQuery,
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
  let headers = (accept: string) => {
    let out = new Headers({ Accept: accept });
    for (let name of [CLIENT_IP_HEADER, CLIENT_CLASS_HEADER]) {
      let value = visitorHeaders[name];
      if (typeof value === 'string') {
        out.set(name, value);
      }
    }
    return out;
  };

  let load: HostRouteLoad = async ({ cardHref, linkFields }) => {
    let response = await handle(
      realm,
      new Request(cardHref, {
        method: 'GET',
        headers: headers(SupportedMimeType.CardJson),
      }),
    );
    if (isMiss(response.status)) {
      return undefined;
    }
    let doc = await readJSON(response, cardHref);
    let resource = (doc as { data?: unknown }).data;
    if (!isCardResource(resource)) {
      throw new HostRouteLookupError(
        `loading ${cardHref} for a host route returned no card`,
        503,
      );
    }
    if (resource.type !== 'card') {
      // A file that isn't a card instance: no card is at this address.
      return undefined;
    }
    return toHostRouteCard(realm, resource, linkFields);
  };

  let search: HostRouteSearch = async ({ filter, linkFields }) => {
    let searchURL = `${realm.url}_search`;
    let request = headers(SupportedMimeType.CardJson);
    request.set('Content-Type', 'application/json');
    let release = await admitSearch();
    if (!release) {
      throw new HostRouteLookupError(
        `the server's search ceiling shed a host route search in ${realm.url}`,
        429,
        String(SEARCH_SHED_RETRY_AFTER_SECONDS),
      );
    }
    let searchRequest: SearchRequest | undefined;
    let doc: unknown;
    try {
      searchRequest = beginSearchRequest();
      searchRequest.attribute([realm.url]);
      let response = await handle(
        realm,
        new Request(searchURL, {
          method: 'QUERY',
          headers: request,
          body: JSON.stringify({
            ...searchEntryWireQueryFromQuery({ filter }, { fields: ['item'] }),
            realms: [realm.url],
          }),
        }),
        { missesAllowed: false },
      );
      doc = await readJSON(response, searchURL);
    } finally {
      release();
      searchRequest?.end();
    }
    if (!isEntryCollectionDocument(doc)) {
      throw new HostRouteLookupError(
        `the host route search in ${realm.url} returned an unexpected document`,
        503,
      );
    }
    let items = new Map<string, CardResourceLike>();
    for (let resource of doc.included ?? []) {
      if (isCardResource(resource) && resource.type === 'card') {
        items.set(resource.id, resource);
      }
    }
    let cards: HostRouteCard[] = [];
    for (let entry of doc.data) {
      let ref = entry.relationships?.item?.data;
      if (!ref || ref.type !== 'card') {
        continue;
      }
      let item = items.get(ref.id);
      if (item) {
        cards.push(toHostRouteCard(realm, item, linkFields));
      }
    }
    return cards;
  };

  return { load, search };
}

interface CardResourceLike {
  type: string;
  id: string;
  relationships?: Record<string, { links?: { self?: string | null } }>;
}

function isCardResource(value: unknown): value is CardResourceLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'string' &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function isMiss(status: number): boolean {
  return status === 401 || status === 403 || status === 404;
}

async function handle(
  realm: Realm,
  request: Request,
  { missesAllowed = true }: { missesAllowed?: boolean } = {},
): Promise<Response> {
  let response = await realm.handle(request);
  if (!response) {
    throw new HostRouteLookupError(
      `${realm.url} did not answer ${request.url}`,
      503,
    );
  }
  if (response.status === 429) {
    throw new HostRouteLookupError(
      `${realm.url} rate-limited a host route lookup of ${request.url}`,
      429,
      response.headers.get('Retry-After') ?? undefined,
    );
  }
  if (!response.ok && !(missesAllowed && isMiss(response.status))) {
    throw new HostRouteLookupError(
      `a host route lookup of ${request.url} answered ${response.status}`,
      503,
    );
  }
  return response;
}

async function readJSON(response: Response, url: string): Promise<unknown> {
  try {
    return await response.json();
  } catch (e) {
    throw new HostRouteLookupError(
      `a host route lookup of ${url} returned a body that isn't JSON: ${e}`,
      503,
    );
  }
}

// The card as the resolver needs it: its served URL, and the served URLs of
// the cards the asked-for link fields point to. A `linksTo` is keyed by the
// field's name, and a `linksToMany` by `<field>.<index>`.
function toHostRouteCard(
  realm: Realm,
  resource: CardResourceLike,
  linkFields: readonly string[],
): HostRouteCard {
  let cardHref = servedHref(realm, resource.id);
  if (linkFields.length === 0) {
    return { cardHref };
  }
  let linkHrefs: Record<string, string[]> = {};
  let relationships = resource.relationships ?? {};
  for (let field of linkFields) {
    let hrefs: { index: number; href: string }[] = [];
    for (let [key, relationship] of Object.entries(relationships)) {
      let self = relationship?.links?.self;
      if (typeof self !== 'string' || self === '') {
        continue;
      }
      let index: number;
      if (key === field) {
        index = 0;
      } else if (
        key.startsWith(`${field}.`) &&
        /^\d+$/.test(key.slice(field.length + 1))
      ) {
        index = Number(key.slice(field.length + 1));
      } else {
        continue;
      }
      hrefs.push({ index, href: servedHref(realm, self, cardHref) });
    }
    if (hrefs.length > 0) {
      linkHrefs[field] = hrefs
        .sort((a, b) => a.index - b.index)
        .map(({ href }) => href);
    }
  }
  return { cardHref, linkHrefs };
}

// A card id or link as the realm wrote it, as a served URL. A value that
// can't be read is returned as it is, and the resolver reports it.
function servedHref(
  realm: Realm,
  reference: string,
  relativeTo: string = realm.url,
): string {
  let network = realm.virtualNetwork;
  try {
    if (network.isRegisteredPrefix(reference)) {
      return network.toURLHref(reference);
    }
    return new URL(reference, relativeTo).href;
  } catch {
    return reference;
  }
}
