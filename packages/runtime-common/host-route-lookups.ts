// The `load` and `search` the host route resolver runs, and the `findCard`
// the canonical address reads the index with, built on a caller's transport.
// The realm server sends each request to the realm in-process; the host app
// sends it through its own fetch. All run as the visitor, and all read the
// answers here, so a path resolves the same way on a full page load and on
// an in-app navigation.
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

import type { HostRouteFindCard } from './host-route-canonical-address.ts';
import type { Filter } from './query.ts';
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
  findCard: HostRouteFindCard;
} {
  let { realmURL, virtualNetwork, lookupError } = transport;
  let href = (reference: string, relativeTo = realmURL) =>
    servedHref(virtualNetwork, reference, relativeTo);
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

  // The card resource at a served URL, as the visitor reads it, or
  // `undefined` for a miss.
  let loadResource = async (
    cardHref: string,
  ): Promise<CardResourceLike | undefined> => {
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
    return resource;
  };

  let load: HostRouteLoad = async ({ cardHref, linkFields }) => {
    let resource = await loadResource(cardHref);
    return resource
      ? toHostRouteCard(virtualNetwork, realmURL, resource, linkFields)
      : undefined;
  };

  // One search of the realm as the visitor, with the full `item` of each
  // result and the cards it links to.
  let runSearch = async (query: object): Promise<SearchResults> => {
    let searchURL = `${realmURL}_search`;
    let run = async () => {
      let response = await send(
        new Request(searchURL, {
          method: 'QUERY',
          headers: headers('application/json'),
          body: JSON.stringify({ ...query, realms: [realmURL] }),
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
    let included = new Map<string, CardResourceLike>();
    for (let resource of doc.included ?? []) {
      if (isCardResource(resource) && resource.type === 'card') {
        included.set(href(resource.id), resource);
      }
    }
    let items: CardResourceLike[] = [];
    for (let entry of doc.data) {
      let ref = entry.relationships?.item?.data;
      if (!ref || ref.type !== 'card') {
        continue;
      }
      let item = included.get(href(ref.id));
      if (item) {
        items.push(item);
      }
    }
    return { items, included };
  };

  let search: HostRouteSearch = async ({ filter, linkFields }) => {
    let { items } = await runSearch(
      searchEntryWireQueryFromQuery({ filter }, { fields: ['item'] }),
    );
    return items.map((item) =>
      toHostRouteCard(virtualNetwork, realmURL, item, linkFields),
    );
  };

  // A search for the one card, on the route's type and `where`. A card the
  // visitor can't read is not in the results, so it is a miss. Under load
  // the realm may leave the linked cards out of a search response, so a
  // value read through a link loads the linked card when the response
  // doesn't carry it.
  let findCard: HostRouteFindCard = async ({
    cardHref,
    type,
    where,
    valueFields,
    linkFields,
  }) => {
    let filter: Filter = where ? { on: type, every: [where] } : { type };
    let { items, included } = await runSearch({
      ...searchEntryWireQueryFromQuery({ filter }, { fields: ['item'] }),
      // One row, so the realm keeps the linked cards in the response
      // under more load before it leaves them out.
      page: { size: 1 },
      cardUrls: [`${cardHref}.json`],
      scope: 'cards',
    });
    let item = items.find((i) => href(i.id) === cardHref);
    if (!item) {
      return undefined;
    }
    let values: Record<string, unknown> = {};
    for (let field of valueFields) {
      values[field] = await readIndexedPath(item, field, {
        realmURL,
        href,
        included,
        loadResource,
      });
    }
    return {
      ...toHostRouteCard(virtualNetwork, realmURL, item, linkFields),
      values,
    };
  };

  return { load, search, findCard };
}

interface CardResourceLike {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { links?: { self?: string | null } }>;
}

interface SearchResults {
  // The `item` of each result, in the order of the results.
  items: CardResourceLike[];
  // Every card resource in the document, the linked cards included, by
  // served URL.
  included: Map<string, CardResourceLike>;
}

// Reads a field, or a dotted path through contained fields and links, from
// a card as the index serializes it: a contained value from `attributes`,
// and a link from `relationships`, followed to the linked card in the
// search document, or loaded with `loadResource` when the document doesn't
// carry it. `undefined` where a step isn't there, a link is empty or its
// card can't be read, and for a plural value, which has no single segment.
async function readIndexedPath(
  card: CardResourceLike,
  path: string,
  {
    realmURL,
    href,
    included,
    loadResource,
  }: {
    realmURL: string;
    href: (reference: string, relativeTo?: string) => string;
    included: Map<string, CardResourceLike>;
    loadResource: (cardHref: string) => Promise<CardResourceLike | undefined>;
  },
): Promise<unknown> {
  let resource = card;
  let node: unknown = card.attributes;
  // The path from the current card to `node`, which is how the card's
  // `relationships` key a link inside a contained field.
  let within: string[] = [];
  for (let name of path.split('.')) {
    let key = [...within, name].join('.');
    let relationship = resource.relationships?.[key];
    if (relationship) {
      let self = relationship.links?.self;
      if (typeof self !== 'string' || self === '') {
        return undefined;
      }
      let targetHref = href(self, href(resource.id));
      let target =
        included.get(targetHref) ??
        // The realm answers only for its own cards.
        (targetHref.startsWith(realmURL)
          ? await loadResource(targetHref)
          : undefined);
      if (!target) {
        return undefined;
      }
      resource = target;
      node = target.attributes;
      within = [];
      continue;
    }
    if (
      node == null ||
      typeof node !== 'object' ||
      Array.isArray(node) ||
      !Object.prototype.hasOwnProperty.call(node, name)
    ) {
      return undefined;
    }
    node = (node as Record<string, unknown>)[name];
    within.push(name);
  }
  return Array.isArray(node) || (node !== null && typeof node === 'object')
    ? undefined
    : node;
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
