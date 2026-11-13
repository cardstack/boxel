import {
  SupportedMimeType,
  isEntryCollectionDocument,
  searchEntryWireQueryFromQuery,
  type HostRouteCard,
  type HostRouteLoad,
  type HostRouteSearch,
  type VirtualNetwork,
} from '@cardstack/runtime-common';

// A host route lookup the realm refused or failed to answer: a rate limit,
// a refused search, a server error, a body that can't be read. The resolver
// stops on it, and the page shows an error state, never the not-found page.
export class HostRouteLookupError extends Error {
  status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'HostRouteLookupError';
    this.status = status;
  }
}

// The `load` and `search` the host route resolver runs in the browser. Each
// one is a request to the routing realm through the app's own fetch, the
// one the store uses, so it runs as the visitor: the realm admits, limits
// and refuses it exactly as it would the visitor's own card request or
// search.
//
// A card the visitor may not read (401, 403) and a card that isn't there
// (404) are misses: the resolver goes on to the next route. A search the
// realm refuses (401, 403) turns the visitor away rather than hiding one
// card, so it is an error, as is every other failure.
//
// Card ids and links come back as the realm writes them, which can be a
// prefix-form identifier or a relative link; each is turned into the served
// URL the resolver compares (`HostRouteCard`).
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
  let load: HostRouteLoad = async ({ cardHref, linkFields }) => {
    let response = await request(fetch, cardHref, {
      method: 'GET',
      headers: { Accept: SupportedMimeType.CardJson },
    });
    if (isMiss(response.status)) {
      return undefined;
    }
    let doc = await readJSON(response, cardHref);
    let resource = (doc as { data?: unknown }).data;
    if (!isCardResource(resource)) {
      throw new HostRouteLookupError(
        `loading ${cardHref} for a host route returned no card`,
      );
    }
    // A file that isn't a card instance (a module, an image) is no card at
    // that id, as in `search`.
    if (resource.type !== 'card') {
      return undefined;
    }
    return toHostRouteCard(virtualNetwork, realmURL, resource, linkFields);
  };

  let search: HostRouteSearch = async ({ filter, linkFields }) => {
    let searchURL = `${realmURL}_search`;
    let response = await request(
      fetch,
      searchURL,
      {
        method: 'QUERY',
        headers: {
          Accept: SupportedMimeType.CardJson,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...searchEntryWireQueryFromQuery({ filter }, { fields: ['item'] }),
          realms: [realmURL],
        }),
      },
      { missesAllowed: false },
    );
    let doc = await readJSON(response, searchURL);
    if (!isEntryCollectionDocument(doc)) {
      throw new HostRouteLookupError(
        `the host route search in ${realmURL} returned an unexpected document`,
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
        cards.push(toHostRouteCard(virtualNetwork, realmURL, item, linkFields));
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

async function request(
  fetch: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  { missesAllowed = true }: { missesAllowed?: boolean } = {},
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (e) {
    throw new HostRouteLookupError(
      `a host route lookup of ${url} failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!response.ok && !(missesAllowed && isMiss(response.status))) {
    throw new HostRouteLookupError(
      `a host route lookup of ${url} answered ${response.status}`,
      response.status,
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
    );
  }
}

// The card as the resolver needs it: its served URL, and the served URLs of
// the cards the asked-for link fields point to. A `linksTo` is keyed by the
// field's name, and a `linksToMany` by `<field>.<index>`.
function toHostRouteCard(
  virtualNetwork: VirtualNetwork,
  realmURL: string,
  resource: CardResourceLike,
  linkFields: readonly string[],
): HostRouteCard {
  let cardHref = servedHref(virtualNetwork, resource.id, realmURL);
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
      hrefs.push({ index, href: servedHref(virtualNetwork, self, cardHref) });
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
  virtualNetwork: VirtualNetwork,
  reference: string,
  relativeTo: string,
): string {
  try {
    if (virtualNetwork.isRegisteredPrefix(reference)) {
      return virtualNetwork.toURLHref(reference);
    }
    return new URL(reference, relativeTo).href;
  } catch {
    return reference;
  }
}
