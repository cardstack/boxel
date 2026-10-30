import {
  CLIENT_CLASS_HEADER,
  CLIENT_IP_HEADER,
  dynamicRouteQuery,
  matchDynamicRoute,
  RealmPaths,
  searchEntryWireQueryFromQuery,
  INFRA_CLIENT_CLASS,
  logger,
  normalizeRoutingPath,
  param,
  projectHostRoutes,
  query as runQuery,
  SupportedMimeType,
  type DBAdapter,
  type HostRouteKind,
  type HostRouteRow,
  type Realm,
  type RouteCard,
  type SitePageType,
  type SiteSettings,
} from '@cardstack/runtime-common';

import { findOrMountRealm, type RealmRoutingDeps } from './realm-routing.ts';

const log = logger('host-routes');

// How many cards one page type may route. Past it the rest go unrouted and
// the problem is logged.
const MAX_CARDS_PER_PAGE_TYPE = 2000;
const SEARCH_PAGE_SIZE = 500;
// A source realm can change without the routing realm reindexing, so a
// table older than this is rebuilt on the next request even when the
// routing realm's settings haven't changed.
const SOURCE_REFRESH_MS = 60_000;

// A page type's filter is written as a Boxel query filter without `on`
// (`{"eq": {"status": "active"}}`). The search wire format anchors the type
// on `item.on`, in the same object as each operator it scopes (as `on` did),
// and addresses fields through `item.`.
export function pageTypeWireFilter(
  pageType: Pick<SitePageType, 'cardType' | 'filter'>,
): Record<string, unknown> {
  let anchor = { 'item.on': pageType.cardType };
  if (!pageType.filter) {
    return anchor;
  }
  return toWire(JSON.parse(pageType.filter), pageType.cardType) as Record<
    string,
    unknown
  >;
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

// The cards a page type matches, as a visitor who isn't signed in finds them:
// the source realm's permissions and policy decide. The search goes through
// the realm's own handler marked as the platform's infrastructure, which a
// policy never rate-limits or blocks but still has to grant.
export async function searchPageTypeCards(
  pageType: SitePageType,
  routingDeps: RealmRoutingDeps,
): Promise<RouteCard[]> {
  let source = await findOrMountRealm(
    new URL(pageType.sourceRealm),
    routingDeps,
  );
  if (!source) {
    log.warn(
      `page type "${pageType.name}": no realm at ${pageType.sourceRealm}`,
    );
    return [];
  }
  let cards: RouteCard[] = [];
  for (let page = 0; cards.length < MAX_CARDS_PER_PAGE_TYPE; page++) {
    let response = await source.handle(
      new Request(new URL('_search', source.url).href, {
        method: 'POST',
        headers: {
          Accept: SupportedMimeType.CardJson,
          'Content-Type': 'application/json',
          'X-HTTP-Method-Override': 'QUERY',
          [CLIENT_CLASS_HEADER]: INFRA_CLIENT_CLASS,
        },
        body: JSON.stringify({
          filter: pageTypeWireFilter(pageType),
          fields: { entry: ['item'] },
          page: { number: page, size: SEARCH_PAGE_SIZE },
        }),
      }),
    );
    if (!response || response.status !== 200) {
      log.warn(
        `page type "${pageType.name}": search of ${source.url} answered ${response?.status}`,
      );
      break;
    }
    let doc = (await response.json()) as {
      data?: unknown[];
      included?: {
        id?: string;
        type?: string;
        attributes?: Record<string, unknown>;
      }[];
    };
    // `included` also carries the cards the matches link to (a product's
    // category); keep only the matches themselves.
    let matched = new Set(
      (doc.data ?? []).map(
        (entry) =>
          (entry as { relationships?: { item?: { data?: { id?: string } } } })
            .relationships?.item?.data?.id,
      ),
    );
    let found = (doc.included ?? []).filter(
      (resource) =>
        resource.type === 'card' &&
        typeof resource.id === 'string' &&
        matched.has(resource.id),
    );
    for (let resource of found) {
      cards.push({ id: resource.id!, attributes: resource.attributes ?? {} });
    }
    if ((doc.data ?? []).length < SEARCH_PAGE_SIZE) {
      break;
    }
  }
  if (cards.length >= MAX_CARDS_PER_PAGE_TYPE) {
    log.warn(
      `page type "${pageType.name}": only the first ${MAX_CARDS_PER_PAGE_TYPE} cards are routed`,
    );
  }
  return cards.slice(0, MAX_CARDS_PER_PAGE_TYPE);
}

export async function loadHostRoutes(
  dbAdapter: DBAdapter,
  realmURL: string,
): Promise<HostRouteRow[]> {
  let rows = (await runQuery(dbAdapter, [
    `SELECT path, kind, card_url, target_path, page_type, claimed_at FROM host_routes WHERE realm_url =`,
    param(realmURL),
  ])) as {
    path: string;
    kind: HostRouteKind;
    card_url: string | null;
    target_path: string | null;
    page_type: number | null;
    claimed_at: string | number;
  }[];
  return rows.map((row) => ({
    path: row.path,
    kind: row.kind,
    cardURL: row.card_url ?? undefined,
    targetPath: row.target_path ?? undefined,
    pageType: row.page_type ?? undefined,
    claimedAt: Number(row.claimed_at),
  }));
}

async function saveHostRoutes(
  dbAdapter: DBAdapter,
  realmURL: string,
  rows: HostRouteRow[],
  now: number,
) {
  await runQuery(dbAdapter, [
    `DELETE FROM host_routes WHERE realm_url =`,
    param(realmURL),
  ]);
  for (let row of rows) {
    await runQuery(dbAdapter, [
      `INSERT INTO host_routes (realm_url, path, kind, card_url, target_path, page_type, claimed_at, updated_at) VALUES (`,
      param(realmURL),
      `,`,
      param(row.path),
      `,`,
      param(row.kind),
      `,`,
      param(row.cardURL ?? null),
      `,`,
      param(row.targetPath ?? null),
      `,`,
      param(row.pageType ?? null),
      `,`,
      param(row.claimedAt),
      `,`,
      param(now),
      `)`,
    ]);
  }
}

export async function lookupHostRoute(
  dbAdapter: DBAdapter,
  realmURL: string,
  path: string,
): Promise<HostRouteRow | undefined> {
  let [row] = (await runQuery(dbAdapter, [
    `SELECT path, kind, card_url, target_path, page_type, claimed_at FROM host_routes WHERE realm_url =`,
    param(realmURL),
    `AND path =`,
    param(path),
  ])) as {
    path: string;
    kind: HostRouteKind;
    card_url: string | null;
    target_path: string | null;
    page_type: number | null;
    claimed_at: string | number;
  }[];
  return row
    ? {
        path: row.path,
        kind: row.kind,
        cardURL: row.card_url ?? undefined,
        targetPath: row.target_path ?? undefined,
        pageType: row.page_type ?? undefined,
        claimedAt: Number(row.claimed_at),
      }
    : undefined;
}

// One rebuild per realm at a time, keyed by the settings object the realm
// returns: it changes when the realm reindexes, which is what makes a
// rebuild due. Source realms changing are caught by SOURCE_REFRESH_MS.
const builds = new WeakMap<
  SiteSettings,
  { promise: Promise<void>; at: number }
>();

export async function refreshHostRoutes(
  realm: Realm,
  routingDeps: RealmRoutingDeps,
): Promise<void> {
  let settings = await realm.getSiteSettings();
  if (!settings.pageTypes.length) {
    return;
  }
  let current = builds.get(settings);
  if (current && Date.now() - current.at < SOURCE_REFRESH_MS) {
    return await current.promise;
  }
  let promise = (async () => {
    let cardsByPageType = new Map<number, RouteCard[]>();
    for (let pageType of settings.pageTypes) {
      cardsByPageType.set(
        pageType.index,
        await searchPageTypeCards(pageType, routingDeps),
      );
    }
    let previous = await loadHostRoutes(routingDeps.dbAdapter, realm.url);
    let now = Date.now();
    let { rows, problems } = projectHostRoutes(
      settings,
      cardsByPageType,
      previous,
      now,
    );
    for (let problem of problems) {
      log.warn(`routes of ${realm.url}: ${problem}`);
    }
    await saveHostRoutes(routingDeps.dbAdapter, realm.url, rows, now);
  })();
  builds.set(settings, { promise, at: Date.now() });
  try {
    await promise;
  } catch (e) {
    builds.delete(settings);
    log.error(`rebuilding the routes of ${realm.url} failed: ${e}`);
  }
}

// The route row a request's path names in its realm, rebuilding the realm's
// table first if it is due. Undefined when the path has no row.
export async function matchHostTableRoute(
  requestURL: URL,
  routingDeps: RealmRoutingDeps,
): Promise<{ realm: Realm; row: HostRouteRow } | undefined> {
  let realm = await findOrMountRealm(requestURL, routingDeps);
  if (!realm) {
    return undefined;
  }
  let mount = new URL(realm.url).pathname;
  let pathname = requestURL.pathname.endsWith('/')
    ? requestURL.pathname
    : `${requestURL.pathname}/`;
  if (!pathname.startsWith(mount)) {
    return undefined;
  }
  let path = normalizeRoutingPath(
    `/${requestURL.pathname.slice(mount.length)}`,
  );
  await refreshHostRoutes(realm, routingDeps);
  let row = await lookupHostRoute(routingDeps.dbAdapter, realm.url, path);
  return row ? { realm, row } : undefined;
}

// The card a dynamic routing rule (`/posts/:slug` with a query) serves at a
// path, searched as the visitor: the request's own address headers go with
// the search, so the realm's permissions and policy answer for them (spec
// D8). Rules are tried in order; one whose query finds nothing falls through
// to the next (D6). Only a card in the rule's own realm is served.
export async function resolveDynamicRoute(
  realm: Realm,
  requestURL: URL,
  requestHeaders: Record<string, string | string[] | undefined>,
): Promise<string | undefined> {
  let routes = await realm.getDynamicRoutes();
  if (!routes.length) {
    return undefined;
  }
  let mount = new URL(realm.url).pathname;
  let pathname = requestURL.pathname.endsWith('/')
    ? requestURL.pathname
    : `${requestURL.pathname}/`;
  if (!pathname.startsWith(mount)) {
    return undefined;
  }
  let path = normalizeRoutingPath(
    `/${requestURL.pathname.slice(mount.length)}`,
  );
  let headers: Record<string, string> = {
    Accept: SupportedMimeType.CardJson,
    'Content-Type': 'application/json',
    'X-HTTP-Method-Override': 'QUERY',
  };
  for (let name of [CLIENT_IP_HEADER, CLIENT_CLASS_HEADER]) {
    let value = requestHeaders[name];
    if (typeof value === 'string') {
      headers[name] = value;
    }
  }
  for (let route of routes) {
    let params = matchDynamicRoute(route, path);
    if (!params) {
      continue;
    }
    let query = dynamicRouteQuery(route, params, realm.url);
    if (!query) {
      log.warn(
        `dynamic route ${route.path} of ${realm.url}: the query is not a Boxel query for ${path}`,
      );
      continue;
    }
    let response = await realm.handle(
      new Request(new URL('_search', realm.url).href, {
        method: 'POST',
        headers,
        body: JSON.stringify(searchEntryWireQueryFromQuery(query)),
      }),
    );
    if (!response || response.status !== 200) {
      log.warn(
        `dynamic route ${route.path} of ${realm.url}: search answered ${response?.status}`,
      );
      continue;
    }
    let doc = (await response.json()) as { data?: { id?: string }[] };
    let id = doc.data?.[0]?.id;
    if (id && new RealmPaths(new URL(realm.url)).inRealm(new URL(id))) {
      return id;
    }
  }
  return undefined;
}
