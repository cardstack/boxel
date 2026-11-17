// The `load` and `search` the host route resolver runs, built on a caller's
// transport. The realm server sends each request to the realm in-process; the
// host app sends it through its own fetch. Both run as the visitor, and both
// read the answers here, so a path resolves the same way on a full page load
// and on an in-app navigation.
//
// A card the visitor may not read (401, 403), a card that isn't there (404)
// and an address that holds a file other than a card are misses: the resolver
// goes on to the next route. A search the realm refuses (401, 403) is not a
// card the visitor can't read but a visitor the realm turns away, so it is an
// error, as is every other failure: a rate limit, an error status, no answer,
// a body that can't be read. The caller's `lookupError` makes each error, so
// it decides what the page answers with.
//
// Card ids and links come back as the realm writes them, which can be a
// prefix-form identifier or a relative link; each is turned into the served
// URL the resolver compares (`HostRouteCard`).

import type {
  HostRouteCard,
  HostRouteLoad,
  HostRouteSearch,
} from './host-route-resolver.ts';
import { isEntryCollectionDocument } from './document-types.ts';
import { searchEntryWireQueryFromQuery } from './search-entry.ts';
import { SupportedMimeType } from './supported-mime-type.ts';
import type { VirtualNetwork } from './virtual-network.ts';

export interface HostRouteLookupTransport {
  // The URL the routing realm is served at, ending with `/`.
  realmURL: string;
  virtualNetwork: VirtualNetwork;
  // Headers every lookup request carries, besides `Accept` and, on a
  // search, `Content-Type`.
  headers?: Record<string, string>;
  // Sends one lookup request. `undefined` is a realm that gave no answer.
  send: (request: Request) => Promise<Response | undefined>;
  // Runs a search, from sending it to reading its body, in whatever slot
  // the caller holds searches in. It may throw to refuse the search.
  withSearchSlot?: <T>(run: () => Promise<T>) => Promise<T>;
  // The error a failed or refused lookup throws. `response` is the answer
  // that failed, when the failure is its status.
  lookupError: (message: string, response?: Response) => Error;
}

export function hostRouteLookups(transport: HostRouteLookupTransport): {
  load: HostRouteLoad;
  search: HostRouteSearch;
} {
  let { realmURL, virtualNetwork, lookupError } = transport;
  let headers = (contentType?: string) => {
    let out = new Headers({ Accept: SupportedMimeType.CardJson });
    for (let [name, value] of Object.entries(transport.headers ?? {})) {
      out.set(name, value);
    }
    if (contentType) {
      out.set('Content-Type', contentType);
    }
    return out;
  };

  let send = async (
    request: Request,
    { missesAllowed = true }: { missesAllowed?: boolean } = {},
  ): Promise<Response> => {
    let response = await transport.send(request);
    if (!response) {
      throw lookupError(`${realmURL} did not answer ${request.url}`);
    }
    if (response.status === 429) {
      throw lookupError(
        `${realmURL} rate-limited a host route lookup of ${request.url}`,
        response,
      );
    }
    if (!response.ok && !(missesAllowed && isMiss(response.status))) {
      throw lookupError(
        `a host route lookup of ${request.url} answered ${response.status}`,
        response,
      );
    }
    return response;
  };

  let readJSON = async (response: Response, url: string): Promise<unknown> => {
    try {
      return await response.json();
    } catch (e) {
      throw lookupError(
        `a host route lookup of ${url} returned a body that isn't JSON: ${e}`,
      );
    }
  };

  let load: HostRouteLoad = async ({ cardHref, linkFields }) => {
    let response = await send(
      new Request(cardHref, { method: 'GET', headers: headers() }),
    );
    if (isMiss(response.status)) {
      return undefined;
    }
    let doc = await readJSON(response, cardHref);
    let resource = (doc as { data?: unknown }).data;
    if (!isCardResource(resource)) {
      throw lookupError(
        `loading ${cardHref} for a host route returned no card`,
      );
    }
    if (resource.type !== 'card') {
      // A file that isn't a card instance: no card is at this address.
      return undefined;
    }
    return toHostRouteCard(virtualNetwork, realmURL, resource, linkFields);
  };

  let search: HostRouteSearch = async ({ filter, linkFields }) => {
    let searchURL = `${realmURL}_search`;
    let run = async () => {
      let response = await send(
        new Request(searchURL, {
          method: 'QUERY',
          headers: headers('application/json'),
          body: JSON.stringify({
            ...searchEntryWireQueryFromQuery({ filter }, { fields: ['item'] }),
            realms: [realmURL],
          }),
        }),
        { missesAllowed: false },
      );
      return await readJSON(response, searchURL);
    };
    let doc = transport.withSearchSlot
      ? await transport.withSearchSlot(run)
      : await run();
    if (!isEntryCollectionDocument(doc)) {
      throw lookupError(
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
