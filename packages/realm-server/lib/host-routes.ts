import {
  CLIENT_CLASS_HEADER,
  CLIENT_IP_HEADER,
  INFRA_CLIENT_CLASS,
  canonicalPathOf,
  isRedirectRoutingRule,
  logger,
  normalizeRoutingPath,
  pageTypeMatchFilter,
  param,
  query,
  separatedByCommas,
  trimExecutableExtension,
  resolveSitePath,
  shareFor,
  SupportedMimeType,
  type Expression,
  type HostRouteShare,
  type Realm,
  type RouteCard,
  type SiteAnswer,
  type SitePageType,
  type SiteSearch,
} from '@cardstack/runtime-common';

import { findOrMountRealm, type RealmRoutingDeps } from './realm-routing.ts';

const log = logger('host-routes');

// A site's addresses come from its page types' path templates, resolved on
// demand against the card index: no table of addresses is kept. A path
// becomes one search (`eq` on the template's fields, which the index's
// containment index serves); a card's address is its fields, expanded.

const SEARCH_PAGE_SIZE = 500;
// How many card ids one search asks a page type about.
const ID_BATCH = 100;

type RequestHeaders = Record<string, string | string[] | undefined>;

// A page type's filter is written as a Boxel query filter without `on`
// (`{"eq": {"status": "active"}}`). The search wire format anchors the type
// on `item.on`, in the same object as each operator it scopes (as `on` did),
// and addresses fields through `item.`.
export function pageTypeWireFilter({
  cardType,
  filter,
}: {
  cardType: SitePageType['cardType'];
  filter: Record<string, unknown>;
}): Record<string, unknown> {
  if (!Object.keys(filter).length) {
    return { 'item.on': cardType };
  }
  return toWire(filter, cardType) as Record<string, unknown>;
}

const FIELD_KEYED = new Set(['eq', 'contains', 'in', 'range']);
const CONNECTIVES = new Set(['every', 'any', 'not']);

function toWire(filter: unknown, cardType: SitePageType['cardType']): unknown {
  if (Array.isArray(filter)) {
    return filter.map((f) => toWire(f, cardType));
  }
  if (!filter || typeof filter !== 'object') {
    return filter;
  }
  let out: Record<string, unknown> = {};
  let isLeaf = true;
  for (let [key, value] of Object.entries(filter)) {
    if (CONNECTIVES.has(key)) {
      isLeaf = false;
      out[key] = toWire(value, cardType);
    } else if (FIELD_KEYED.has(key) && value && typeof value === 'object') {
      out[key] = Object.fromEntries(
        Object.entries(value).map(([field, v]) => [
          field.startsWith('item.') ? field : `item.${field}`,
          v,
        ]),
      );
    } else {
      out[key] = value;
    }
  }
  if (isLeaf && !('item.on' in out)) {
    out['item.on'] = cardType;
  }
  return out;
}

// A search failed, so its answer can't be read as "no cards".
export class SiteSearchError extends Error {}

function searchHeaders(
  requestHeaders?: RequestHeaders,
): Record<string, string> {
  let headers: Record<string, string> = {
    Accept: SupportedMimeType.CardJson,
    'Content-Type': 'application/json',
    'X-HTTP-Method-Override': 'QUERY',
  };
  if (requestHeaders) {
    // As the visitor: their address headers go with the search, so the
    // realm's permissions and policy answer for them.
    for (let name of [CLIENT_IP_HEADER, CLIENT_CLASS_HEADER]) {
      let value = requestHeaders[name];
      if (typeof value === 'string') {
        headers[name] = value;
      }
    }
  } else {
    // The platform's own lookups, which a policy never rate-limits or blocks
    // but still has to grant.
    headers[CLIENT_CLASS_HEADER] = INFRA_CLIENT_CLASS;
  }
  return headers;
}

interface SearchResource {
  id?: string;
  type?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<
    string,
    { links?: { self?: string | null }; data?: { id?: string } | null }
  >;
}

function routeCardOf(
  resource: SearchResource,
  byId: Map<string, SearchResource>,
  depth = 0,
): RouteCard {
  let links: Record<string, string> = {};
  let linked: Record<string, RouteCard> = {};
  for (let [field, rel] of Object.entries(resource.relationships ?? {})) {
    let target = rel?.data?.id ?? rel?.links?.self;
    if (typeof target !== 'string' || !target) {
      continue;
    }
    let href: string;
    try {
      href = new URL(target, resource.id).href;
    } catch {
      continue;
    }
    links[field] = href;
    let included = byId.get(href) ?? byId.get(href.replace(/\.json$/, ''));
    if (included && depth < 2) {
      linked[field] = routeCardOf(included, byId, depth + 1);
    }
  }
  return {
    id: resource.id!,
    attributes: resource.attributes ?? {},
    links,
    linked,
  };
}

// The cards of a page type a filter matches in its source realm, with the
// cards they link to. Throws `SiteSearchError` when the search fails.
export async function searchSiteCards(
  pageType: SitePageType,
  filter: Record<string, unknown>,
  page: { number: number; size: number },
  deps: RealmRoutingDeps,
  requestHeaders?: RequestHeaders,
  sort?: string,
): Promise<{ cards: RouteCard[]; total?: number }> {
  let source = await findOrMountRealm(new URL(pageType.sourceRealm), deps);
  if (!source) {
    throw new SiteSearchError(
      `page type "${pageType.name}": no realm at ${pageType.sourceRealm}`,
    );
  }
  let response = await source.handle(
    new Request(new URL('_search', source.url).href, {
      method: 'POST',
      headers: searchHeaders(requestHeaders),
      body: JSON.stringify({
        filter: pageTypeWireFilter({ cardType: pageType.cardType, filter }),
        fields: { entry: ['item'] },
        page,
        ...(sort ? { sort: wireSort(sort) } : {}),
      }),
    }),
  );
  if (!response || response.status !== 200) {
    throw new SiteSearchError(
      `page type "${pageType.name}": search of ${source.url} answered ${response?.status}`,
    );
  }
  let doc = (await response.json()) as {
    data?: { relationships?: { item?: { data?: { id?: string } } } }[];
    included?: SearchResource[];
    meta?: { page?: { total?: number } };
  };
  let byId = new Map<string, SearchResource>();
  for (let resource of doc.included ?? []) {
    if (typeof resource.id === 'string') {
      byId.set(resource.id, resource);
    }
  }
  let cards: RouteCard[] = [];
  for (let entry of doc.data ?? []) {
    let id = entry.relationships?.item?.data?.id;
    let resource = id ? byId.get(id) : undefined;
    if (resource?.type === 'card') {
      cards.push(routeCardOf(resource, byId));
    }
  }
  return { cards, total: doc.meta?.page?.total };
}

// A page type's sort, written as a Boxel query sort, in the search wire format,
// which addresses a card's fields through `item.`.
function wireSort(sort: string): unknown[] {
  return (JSON.parse(sort) as Record<string, unknown>[]).map((entry) => {
    let out: Record<string, unknown> = {};
    for (let [key, value] of Object.entries(entry)) {
      if (key === 'by' && typeof value === 'string') {
        out.by = value.startsWith('item.') ? value : `item.${value}`;
      } else if (key === 'on') {
        out['item.on'] = value;
      } else {
        out[key] = value;
      }
    }
    return out;
  });
}

function combine(
  pageType: SitePageType,
  clause: Record<string, unknown>,
): Record<string, unknown> {
  return pageType.filter
    ? { every: [JSON.parse(pageType.filter), clause] }
    : clause;
}

// The searches a site's paths resolve through.
export function siteSearch(
  deps: RealmRoutingDeps,
  requestHeaders?: RequestHeaders,
): SiteSearch {
  return {
    async matches(pageType, values, limit) {
      let { cards } = await searchSiteCards(
        pageType,
        pageTypeMatchFilter(pageType, values),
        { number: 0, size: limit },
        deps,
        requestHeaders,
        pageType.sort,
      );
      if (cards.length > 1) {
        log.warn(
          `page type "${pageType.name}": ${cards.length} cards share the address values ${JSON.stringify(values)}; serving ${cards[0].id}`,
        );
      }
      return cards;
    },
    async routes(pageType, card) {
      let { cards } = await searchSiteCards(
        pageType,
        combine(pageType, { eq: { id: card.id } }),
        { number: 0, size: 1 },
        deps,
        requestHeaders,
      );
      return cards.length > 0;
    },
  };
}

// What the routing realm's site serves at a request URL under its mount.
// A failed search answers as nothing found and is logged.
export async function resolveSiteRequest(
  realm: Realm,
  requestURL: URL,
  deps: RealmRoutingDeps,
  requestHeaders?: RequestHeaders,
): Promise<SiteAnswer & { share?: HostRouteShare }> {
  let settings = await realm.getSiteSettings();
  if (!settings.pageTypes.length && !settings.redirects.length) {
    return { kind: 'none' };
  }
  let path = sitePathOf(realm, requestURL);
  if (path === undefined) {
    return { kind: 'none' };
  }
  try {
    let answer = await resolveSitePath(
      settings,
      path,
      siteSearch(deps, requestHeaders),
    );
    if (answer.kind === 'page') {
      return { ...answer, share: shareFor(answer.pageType, answer.card) };
    }
    return answer;
  } catch (e) {
    log.warn(`resolving ${requestURL.href}: ${e}`);
    return { kind: 'none' };
  }
}

// Where a site is mounted on the host a request came in on, and the mount its
// canonical links name, each with a trailing slash. Host Mode v2 maps host
// URLs to realms (so one realm can answer at /owner/shop/ on one host and at /
// on another), and the owner picks the canonical one. Until that mapping
// exists, both are the realm's own path on the request's host.
export function siteMounts(
  realm: Realm,
  requestURL: URL,
): { mount: URL; canonical: URL } {
  let mount = new URL(new URL(realm.url).pathname, requestURL);
  return { mount, canonical: mount };
}

// The site a mount URL names: the realm mounted exactly there.
export async function siteAt(
  mountURL: URL,
  deps: RealmRoutingDeps,
): Promise<Realm | undefined> {
  let realm = await findOrMountRealm(mountURL, deps);
  return realm &&
    siteMounts(realm, mountURL).mount.pathname === mountURL.pathname
    ? realm
    : undefined;
}

// The realms a site draws on: its page types' source realms and the realms
// holding its frame and not-found cards, other than its own.
export async function siteSourceRealms(
  site: Realm,
  deps: RealmRoutingDeps,
): Promise<string[]> {
  let settings = await site.getSiteSettings();
  let sources = new Set(settings.pageTypes.map((t) => t.sourceRealm));
  for (let card of [settings.frame, settings.notFound]) {
    if (card) {
      let realm = await findOrMountRealm(new URL(card), deps).catch(
        () => undefined,
      );
      if (realm) {
        sources.add(realm.url);
      }
    }
  }
  sources.delete(site.url);
  return [...sources];
}

// What a site's pages show changes only with the indexes of the realms it
// draws on and the host shell: a key for them, from each realm's current
// index generation. Every index commit, including a change to realm.json,
// moves a realm's generation.
export async function siteGenerations(
  site: Realm,
  deps: RealmRoutingDeps,
): Promise<string> {
  let realms = [site.url, ...(await siteSourceRealms(site, deps))].sort();
  let rows = (await query(deps.dbAdapter, [
    `SELECT realm_url, current_generation FROM realm_generations WHERE realm_url IN (`,
    ...separatedByCommas(realms.map((url) => [param(url)])),
    `)`,
  ] as Expression)) as { realm_url: string; current_generation: number }[];
  let byRealm = new Map(rows.map((r) => [r.realm_url, r.current_generation]));
  return realms.map((url) => `${url}=${byRealm.get(url) ?? 0}`).join(' ');
}

// A request URL's path relative to the realm's mount, normalized; undefined
// when the URL is outside the realm.
export function sitePathOf(realm: Realm, requestURL: URL): string | undefined {
  let mount = siteMounts(realm, requestURL).mount.pathname;
  let pathname = requestURL.pathname.endsWith('/')
    ? requestURL.pathname
    : `${requestURL.pathname}/`;
  if (!pathname.startsWith(mount)) {
    return undefined;
  }
  return normalizeRoutingPath(`/${requestURL.pathname.slice(mount.length)}`);
}

function cardKey(url: string): string {
  let key = new URL(url);
  key.hash = '';
  key.search = '';
  return key.href.replace(/\.json$/, '');
}

// Where the site serves each of some cards: the exact routing rules first,
// then each page type in declared order, asking it about the cards in
// batches and expanding its template for the ones it routes. A card no rule
// or page type routes has no entry. A failed search leaves its cards out.
export async function sitePathsForCards(
  realm: Realm,
  cardURLs: string[],
  deps: RealmRoutingDeps,
): Promise<Map<string, { path: string; share?: HostRouteShare }>> {
  let paths = new Map<string, { path: string; share?: HostRouteShare }>();
  let wanted = new Set<string>();
  for (let url of cardURLs) {
    try {
      wanted.add(cardKey(url));
    } catch {
      // not a URL
    }
  }
  for (let rule of await realm.getHostRoutingMap()) {
    if (isRedirectRoutingRule(rule)) {
      continue;
    }
    let key = cardKey(rule.id);
    if (wanted.has(key) && !paths.has(key)) {
      paths.set(key, { path: normalizeRoutingPath(rule.path) });
    }
  }
  let settings = await realm.getSiteSettings();
  let pageTypes = settings.pageTypes.filter((t) => t.template);
  // The types each linked card is, from one read of the index, so each page
  // type is searched only for the cards it can match. A card the index
  // doesn't hold has no address, since every search reads the same index.
  let types = await indexedTypes(
    [...wanted].filter((key) => !paths.has(key)),
    deps,
  );
  for (let pageType of pageTypes) {
    let typeKey = pageTypeKey(pageType);
    let remaining = [...wanted].filter(
      (key) => !paths.has(key) && types.get(key)?.includes(typeKey),
    );
    for (let i = 0; i < remaining.length; i += ID_BATCH) {
      let ids = remaining.slice(i, i + ID_BATCH);
      let cards: RouteCard[];
      try {
        ({ cards } = await searchSiteCards(
          pageType,
          combine(pageType, { any: ids.map((id) => ({ eq: { id } })) }),
          { number: 0, size: ids.length },
          deps,
        ));
      } catch (e) {
        log.warn(`${e}`);
        continue;
      }
      for (let card of cards) {
        let key = cardKey(card.id);
        if (paths.has(key)) {
          continue;
        }
        let path = canonicalPathOf(settings, card, (t) => t === pageType);
        if (path) {
          paths.set(key, { path, share: shareFor(pageType, card) });
        }
      }
    }
  }
  return paths;
}

// A page type's card type as the index lists it among a card's types (and
// the search's `on` matches it): `<module>/<name>`, without the module's
// extension. A card's types include every class it descends from.
function pageTypeKey(pageType: SitePageType): string {
  return `${trimExecutableExtension(pageType.cardType.module)}/${pageType.cardType.name}`;
}

// The types of each card the index holds an instance for, by card key.
async function indexedTypes(
  keys: string[],
  deps: RealmRoutingDeps,
): Promise<Map<string, string[]>> {
  let types = new Map<string, string[]>();
  for (let i = 0; i < keys.length; i += ID_BATCH) {
    let batch = keys.slice(i, i + ID_BATCH);
    let rows = (await query(deps.dbAdapter, [
      `SELECT file_alias, types FROM boxel_index
       WHERE type = 'instance' AND is_deleted IS NOT TRUE AND file_alias IN (`,
      ...separatedByCommas(batch.map((key) => [param(key)])),
      `)`,
    ] as Expression)) as {
      file_alias: string;
      types: string[] | string | null;
    }[];
    for (let row of rows) {
      let list =
        typeof row.types === 'string' ? JSON.parse(row.types) : row.types;
      if (Array.isArray(list)) {
        types.set(row.file_alias, [
          ...(types.get(row.file_alias) ?? []),
          ...list,
        ]);
      }
    }
  }
  return types;
}

// Every address a site serves, for its sitemap: the fixed pages and listing
// paths, then each page type's cards in pages of the search. `skip` and
// `take` select a window across all of them, so one sitemap file of a large
// site reads only its own part. `total` counts every address.
export async function sitePaths(
  realm: Realm,
  deps: RealmRoutingDeps,
  { skip = 0, take = Infinity }: { skip?: number; take?: number } = {},
): Promise<{ paths: string[]; total: number }> {
  let settings = await realm.getSiteSettings();
  let fixed = new Set<string>(['/']);
  for (let rule of await realm.getHostRoutingMap()) {
    if (!isRedirectRoutingRule(rule)) {
      fixed.add(normalizeRoutingPath(rule.path));
    }
  }
  for (let pageType of settings.pageTypes) {
    if (pageType.listingPath) {
      fixed.add(pageType.listingPath);
    }
  }
  let routed = settings.pageTypes.filter((t) => t.template);
  let filterOf = (t: SitePageType) =>
    t.filter ? (JSON.parse(t.filter) as Record<string, unknown>) : {};
  let totals = await Promise.all(
    routed.map(
      async (t) =>
        (await searchSiteCards(t, filterOf(t), { number: 0, size: 1 }, deps))
          .total ?? 0,
    ),
  );
  let total = fixed.size + totals.reduce((a, b) => a + b, 0);

  let out = [...fixed].slice(skip, skip + take);
  let position = fixed.size;
  for (let [i, pageType] of routed.entries()) {
    let count = totals[i];
    let from = Math.max(skip, position);
    let to = Math.min(skip + take, position + count);
    if (from < to) {
      // Card positions in this page type, from its first search page.
      let offset = from - position;
      for (
        let number = Math.floor(offset / SEARCH_PAGE_SIZE);
        number * SEARCH_PAGE_SIZE < to - position;
        number++
      ) {
        let { cards } = await searchSiteCards(
          pageType,
          filterOf(pageType),
          { number, size: SEARCH_PAGE_SIZE },
          deps,
        );
        cards.forEach((card, j) => {
          let at = position + number * SEARCH_PAGE_SIZE + j;
          if (at < from || at >= to) {
            return;
          }
          let path = canonicalPathOf(settings, card, (t) => t === pageType);
          if (path) {
            out.push(path);
          }
        });
        if (cards.length < SEARCH_PAGE_SIZE) {
          break;
        }
      }
    }
    position += count;
  }
  return { paths: out, total };
}

// The card a site serves at `/`: the exact routing rule for it, else the
// realm's index card. A listing path serves it too, since a listing has no
// card of its own: the site's home card draws the listing for its path.
export async function siteHomeCard(realm: Realm): Promise<string> {
  for (let rule of await realm.getHostRoutingMap()) {
    if (
      !isRedirectRoutingRule(rule) &&
      normalizeRoutingPath(rule.path) === '/'
    ) {
      return rule.id;
    }
  }
  return new URL('index', realm.url).href;
}
