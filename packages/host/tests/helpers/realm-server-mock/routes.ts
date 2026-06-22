import {
  buildSearchErrorResponse,
  baseRealm,
  ensureTrailingSlash,
  parsePrerenderedSearchRequestFromPayload,
  parseRealmsFromPayload,
  parseSearchEntryQueryFromPayload,
  parseSearchQueryFromPayload,
  parseSearchRequestPayload,
  SearchRequestError,
  sanitizeLoggingCorrelationId,
  searchEntryRealms,
  searchPrerenderedRealms,
  searchRealms,
  SupportedMimeType,
  X_BOXEL_LOGGING_CORRELATION_ID_HEADER,
  type RealmInfo,
  type Query,
  type SearchEntryCollectionDocument,
  type SearchEntryQuery,
} from '@cardstack/runtime-common';

import {
  makeCardTypeSummaryDoc,
  type LinkableCollectionDocument,
  type PrerenderedCardCollectionDocument,
} from '@cardstack/runtime-common/document-types';

import ENV from '@cardstack/host/config/environment';

import { getRoomIdForRealmAndUser } from '../mock-matrix/_utils';
import { createJWT, testRealmSecretSeed } from '../test-auth';
import { getTestRealmRegistry } from '../test-realm-registry';

import type { TestRealmAdapter } from '../adapter';

import type { RealmServerMockRoute, RealmServerMockState } from './types';

const TEST_MATRIX_USER = '@testuser:localhost';

// Module-level override for the /_catalog-realms mock endpoint. Tests that
// pretend a local test realm *is* the catalog (e.g. catalog-app-browse) need
// the realm-server mock to return their test realm URL instead of the real
// ENV.resolvedCatalogRealmURL. Because the mock route handler is registered
// once at module load time and shared across all tests in a run, this must be
// module-level mutable state rather than per-test instance state. Always pair
// setCatalogRealmURL with resetCatalogRealmURL in afterEach to avoid leaking
// overrides between test modules.
let catalogRealmURLOverrides: string[] = [];

export function setCatalogRealmURL(...urls: string[]) {
  catalogRealmURLOverrides = urls.map(ensureTrailingSlash);
}

export function resetCatalogRealmURL() {
  catalogRealmURLOverrides = [];
}

type SearchableRealm = {
  url?: string;
  // The live-card document a `Realm.search` resolves to.
  search: (query: Query) => Promise<LinkableCollectionDocument>;
  searchPrerendered: (
    query: Query,
    opts: Pick<
      ReturnType<typeof parsePrerenderedSearchRequestFromPayload>,
      'htmlFormat' | 'cardUrls' | 'renderType'
    >,
  ) => Promise<PrerenderedCardCollectionDocument>;
};

const remoteRealmCache = new Map<string, SearchableRealm>();

export function clearRemoteRealmCache() {
  remoteRealmCache.clear();
}

const realmServerRoutes = new Map<string, RealmServerMockRoute>();

function normalizeRoutePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

export function registerRealmServerRoute(route: RealmServerMockRoute) {
  realmServerRoutes.set(normalizeRoutePath(route.path), route);
}

export function getRealmServerRoute(
  url: URL,
): RealmServerMockRoute | undefined {
  return realmServerRoutes.get(url.pathname);
}

export function registerDefaultRoutes() {
  registerSearchRoutes();
  registerInfoRoutes();
  registerTypesRoutes();
  registerCatalogRoutes();
  registerAuthRoutes();
}

function registerSearchRoutes() {
  registerRealmServerRoute({
    path: '/_federated-search',
    handler: async (req, _url) => {
      let realmList: string[];
      let payload: unknown;
      try {
        payload = await parseSearchRequestPayload(req);
        realmList = parseRealmsFromPayload(payload);
      } catch (e) {
        if (e instanceof SearchRequestError) {
          return buildSearchErrorResponse(e.message);
        }
        throw e;
      }

      let cardsQuery;
      try {
        cardsQuery = parseSearchQueryFromPayload(payload);
      } catch (e) {
        if (e instanceof SearchRequestError) {
          return buildSearchErrorResponse(e.message);
        }
        throw e;
      }

      // Mirror the realm-server's `handle-search`: read the client's
      // correlation id off the request and thread it into searchRealms, so
      // the real `realm:search-timing` line is emitted (and observable by
      // host integration tests) keyed by the id the client minted.
      let loggingCorrelationId = sanitizeLoggingCorrelationId(
        req.headers.get(X_BOXEL_LOGGING_CORRELATION_ID_HEADER),
      );
      let combined = await searchRealms(
        realmList.map((realmURL) => getSearchableRealmForURL(realmURL)),
        cardsQuery,
        loggingCorrelationId ? { loggingCorrelationId } : undefined,
      );

      return new Response(JSON.stringify(combined), {
        status: 200,
        headers: { 'content-type': SupportedMimeType.CardJson },
      });
    },
  });

  registerRealmServerRoute({
    path: '/_federated-search-v2',
    handler: async (req, _url) => {
      let realmList: string[];
      let payload: unknown;
      try {
        payload = await parseSearchRequestPayload(req);
        realmList = parseRealmsFromPayload(payload);
      } catch (e) {
        if (e instanceof SearchRequestError) {
          return buildSearchErrorResponse(e.message);
        }
        throw e;
      }

      let parsed;
      try {
        parsed = parseSearchEntryQueryFromPayload(payload);
      } catch (e) {
        if (e instanceof SearchRequestError) {
          return buildSearchErrorResponse(e.message);
        }
        throw e;
      }

      // Mirror the realm-server's `handle-search-v2`: read the client's
      // correlation id off the request and thread it into searchEntryRealms,
      // so the real `realm:search-timing` line is emitted (and observable by
      // host integration tests) keyed by the id the client minted.
      let loggingCorrelationId = sanitizeLoggingCorrelationId(
        req.headers.get(X_BOXEL_LOGGING_CORRELATION_ID_HEADER),
      );
      let combined = await searchEntryRealms(
        realmList.map((realmURL) =>
          getSearchEntrySearchableRealmForURL(realmURL, payload),
        ),
        parsed,
        loggingCorrelationId ? { loggingCorrelationId } : undefined,
      );

      return new Response(JSON.stringify(combined), {
        status: 200,
        headers: { 'content-type': SupportedMimeType.CardJson },
      });
    },
  });

  registerRealmServerRoute({
    path: '/_federated-search-prerendered',
    handler: async (req, _url) => {
      let realmList: string[];
      let payload: unknown;
      try {
        payload = await parseSearchRequestPayload(req);
        realmList = parseRealmsFromPayload(payload);
      } catch (e) {
        if (e instanceof SearchRequestError) {
          return buildSearchErrorResponse(e.message);
        }
        throw e;
      }

      let parsed;
      try {
        parsed = parsePrerenderedSearchRequestFromPayload(payload);
      } catch (e) {
        if (e instanceof SearchRequestError) {
          return buildSearchErrorResponse(e.message);
        }
        throw e;
      }

      let combined = await searchPrerenderedRealms(
        realmList.map((realmURL) => getSearchableRealmForURL(realmURL)),
        parsed.cardsQuery,
        {
          htmlFormat: parsed.htmlFormat,
          cardUrls: parsed.cardUrls,
          renderType: parsed.renderType,
        },
      );

      return new Response(JSON.stringify(combined), {
        status: 200,
        headers: { 'content-type': SupportedMimeType.CardJson },
      });
    },
  });
}

function registerInfoRoutes() {
  registerRealmServerRoute({
    path: '/_federated-info',
    handler: async (req) => {
      let payload;
      try {
        payload = await parseSearchRequestPayload(req.clone());
      } catch (e) {
        if (e instanceof SearchRequestError) {
          return buildSearchErrorResponse(e.message);
        }
        throw e;
      }

      let realmList: string[];
      try {
        realmList = parseRealmsFromPayload(payload);
      } catch (e) {
        if (e instanceof SearchRequestError) {
          return buildSearchErrorResponse(e.message);
        }
        throw e;
      }

      let data: { id: string; type: 'realm-info'; attributes: RealmInfo }[] =
        [];
      let publicReadableRealms: string[] = [];

      for (let realmURL of realmList) {
        let info = await getRealmInfoForURL(realmURL);
        if (!info) {
          continue;
        }
        if (info.visibility === 'public') {
          publicReadableRealms.push(ensureTrailingSlash(realmURL));
        }
        data.push({ id: realmURL, type: 'realm-info', attributes: info });
      }

      let headers: Record<string, string> = {
        'content-type': SupportedMimeType.RealmInfo,
      };
      if (publicReadableRealms.length > 0) {
        headers['x-boxel-realms-public-readable'] =
          publicReadableRealms.join(',');
      }

      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers,
      });
    },
  });
}

function registerTypesRoutes() {
  registerRealmServerRoute({
    path: '/_federated-types',
    handler: async (req) => {
      let payload;
      try {
        payload = await parseSearchRequestPayload(req.clone());
      } catch (e) {
        if (e instanceof SearchRequestError) {
          return buildSearchErrorResponse(e.message);
        }
        throw e;
      }

      let realmList: string[];
      try {
        realmList = parseRealmsFromPayload(payload);
      } catch (e) {
        if (e instanceof SearchRequestError) {
          return buildSearchErrorResponse(e.message);
        }
        throw e;
      }

      let searchKey = (payload as Record<string, unknown>).searchKey as
        | string
        | undefined;
      let page = (payload as Record<string, unknown>).page as
        | { number: number; size: number }
        | undefined;

      let registry = getTestRealmRegistry();
      let allEntries: {
        id: string;
        type: 'card-type-summary';
        attributes: {
          displayName: string;
          total: number;
          iconHTML: string;
          kind: 'instance' | 'file';
        };
        meta: { realmURL: string };
      }[] = [];

      for (let realmURL of realmList) {
        let normalizedURL = ensureTrailingSlash(realmURL);
        let registryEntry = registry.get(normalizedURL);
        if (registryEntry?.realm) {
          let summaries =
            await registryEntry.realm.realmIndexQueryEngine.fetchCardTypeSummary();
          let doc = makeCardTypeSummaryDoc(summaries);
          for (let entry of doc.data) {
            allEntries.push({
              ...entry,
              type: 'card-type-summary' as const,
              meta: { realmURL: normalizedURL },
            });
          }
        }
      }

      // Apply searchKey filter
      if (searchKey) {
        let term = searchKey.toLowerCase();
        allEntries = allEntries.filter((entry) =>
          entry.attributes.displayName.toLowerCase().includes(term),
        );
      }

      // Sort alphabetically by displayName so pagination returns a stable order
      allEntries.sort((a, b) =>
        (a.attributes.displayName ?? '').localeCompare(
          b.attributes.displayName ?? '',
        ),
      );

      let total = allEntries.length;

      // Apply pagination
      if (page) {
        let start = page.number * page.size;
        allEntries = allEntries.slice(start, start + page.size);
      }

      return new Response(
        JSON.stringify({
          data: allEntries,
          meta: { page: { total } },
        }),
        {
          status: 200,
          headers: { 'content-type': SupportedMimeType.CardTypeSummary },
        },
      );
    },
  });
}

function registerCatalogRoutes() {
  registerRealmServerRoute({
    path: '/_catalog-realms',
    handler: async () => {
      let catalogURLs = (
        catalogRealmURLOverrides.length > 0
          ? [...catalogRealmURLOverrides, ENV.resolvedSkillsRealmURL]
          : [ENV.resolvedCatalogRealmURL, ENV.resolvedSkillsRealmURL]
      )
        .filter(Boolean)
        .map((url) => ensureTrailingSlash(url as string));
      let data = catalogURLs.map((realmURL) => ({
        id: realmURL,
        type: 'catalog-realm',
      }));
      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { 'content-type': SupportedMimeType.JSONAPI },
      });
    },
  });
}

function registerAuthRoutes() {
  registerRealmServerRoute({
    path: '/_realm-auth',
    handler: async (_req, _url, state: RealmServerMockState) => {
      let realmServerURL = ensureTrailingSlash(_url.origin);
      const authTokens: Record<string, string> = {};
      for (let [realmURL, permissions] of state.realmPermissions.entries()) {
        if (state.ensureSessionRoom) {
          await state.ensureSessionRoom(realmURL, TEST_MATRIX_USER);
        }
        authTokens[realmURL] = createJWT(
          {
            user: TEST_MATRIX_USER,
            sessionRoom: getRoomIdForRealmAndUser(realmURL, TEST_MATRIX_USER),
            permissions,
            realm: realmURL,
            realmServerURL,
          },
          '1d',
          testRealmSecretSeed,
        );
      }
      return new Response(JSON.stringify(authTokens), { status: 200 });
    },
  });

  registerRealmServerRoute({
    path: '/_server-session',
    handler: async (req) => {
      let data = await req.json();
      if (!data.access_token) {
        return new Response(
          JSON.stringify({
            errors: [`Request body missing 'access_token' property`],
          }),
          { status: 400 },
        );
      }
      return new Response(null, {
        status: 201,
        headers: {
          Authorization: createJWT(
            {
              user: TEST_MATRIX_USER,
              sessionRoom: 'test-auth-realm-server-session-room',
            },
            '1d',
            testRealmSecretSeed,
          ),
        },
      });
    },
  });

  registerRealmServerRoute({
    path: '/_delete-realm',
    handler: async (req, _url, state: RealmServerMockState) => {
      let body = (await req.json()) as {
        data?: { id?: string; type?: string };
      };
      let realmURL = body.data?.id;
      if (!realmURL || body.data?.type !== 'realm') {
        return new Response(
          JSON.stringify({ errors: ['Request body must include a realm id'] }),
          {
            status: 400,
            headers: { 'content-type': SupportedMimeType.JSONAPI },
          },
        );
      }

      let normalizedRealmURL = ensureTrailingSlash(realmURL);
      let permissions = state.realmPermissions.get(normalizedRealmURL);
      if (!permissions?.includes('realm-owner')) {
        return new Response(JSON.stringify({ errors: ['Forbidden'] }), {
          status: 403,
          headers: { 'content-type': SupportedMimeType.JSONAPI },
        });
      }

      let namespace = new URL(normalizedRealmURL).pathname
        .split('/')
        .filter(Boolean)
        .at(-2);
      if (namespace !== 'testuser') {
        return new Response(
          JSON.stringify({
            errors: ['You can only delete realms that you created'],
          }),
          {
            status: 403,
            headers: { 'content-type': SupportedMimeType.JSONAPI },
          },
        );
      }

      state.realmPermissions.delete(normalizedRealmURL);
      getTestRealmRegistry().delete(normalizedRealmURL);

      return new Response(null, {
        status: 204,
        headers: { 'content-type': SupportedMimeType.JSONAPI },
      });
    },
  });
}

function getSearchableRealmForURL(
  realmURL: string,
): SearchableRealm | undefined {
  let registry = getTestRealmRegistry();
  let registryEntry = registry.get(ensureTrailingSlash(realmURL));
  if (registryEntry?.realm) {
    return registryEntry.realm;
  }

  let cached = remoteRealmCache.get(realmURL);
  if (cached) {
    return cached;
  }

  let resolvedRealmURL = resolveRemoteRealmURL(realmURL);
  if (isInProcessRealmURL(resolvedRealmURL)) {
    // In-process realm not in the registry: there is no real server to search,
    // so treat it as unavailable. searchRealms() drops undefined entries.
    return undefined;
  }
  let remoteRealm: SearchableRealm = {
    url: resolvedRealmURL,
    // pass thru for live realms on localhost:4201 (base, skills, catalog)
    async search(query: Query) {
      let url = new URL('_search', resolvedRealmURL);
      let response = await globalThis.fetch(url.href, {
        method: 'QUERY',
        headers: {
          Accept: SupportedMimeType.CardJson,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(query),
      });
      if (!response.ok) {
        let responseText = await response.text();
        throw new Error(
          `Remote realm search failed for ${resolvedRealmURL}: ${response.status} ${responseText}`,
        );
      }
      return (await response.json()) as LinkableCollectionDocument;
    },
    async searchPrerendered(query: Query, opts) {
      let url = new URL('_search-prerendered', resolvedRealmURL);
      let response = await globalThis.fetch(url.href, {
        method: 'QUERY',
        headers: {
          Accept: SupportedMimeType.CardJson,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...query,
          prerenderedHtmlFormat: opts.htmlFormat,
          cardUrls: opts.cardUrls,
          renderType: opts.renderType,
        }),
      });
      if (!response.ok) {
        let responseText = await response.text();
        throw new Error(
          `Remote realm prerendered search failed for ${resolvedRealmURL}: ${response.status} ${responseText}`,
        );
      }
      return (await response.json()) as PrerenderedCardCollectionDocument;
    },
  };

  remoteRealmCache.set(realmURL, remoteRealm);
  return remoteRealm;
}

// The v2 counterpart of `getSearchableRealmForURL`. In-process registry
// realms expose `searchEntries` directly; a live remote realm (base, skills,
// catalog on localhost:4201) is reached by passing the original wire payload
// through to its per-realm `_search-v2` endpoint — the parsed query the
// fan-out hands us is the server's internal form and has no wire spelling,
// so the passthrough closes over the raw payload instead.
function getSearchEntrySearchableRealmForURL(
  realmURL: string,
  rawPayload: unknown,
):
  | {
      url?: string;
      searchEntries: (
        searchEntryQuery: SearchEntryQuery,
      ) => Promise<SearchEntryCollectionDocument>;
    }
  | undefined {
  let registry = getTestRealmRegistry();
  let registryEntry = registry.get(ensureTrailingSlash(realmURL));
  if (registryEntry?.realm) {
    return registryEntry.realm;
  }

  let resolvedRealmURL = resolveRemoteRealmURL(realmURL);
  if (isInProcessRealmURL(resolvedRealmURL)) {
    // In-process realm not in the registry: there is no real server to
    // search, so treat it as unavailable. searchEntryRealms() drops undefined
    // entries.
    return undefined;
  }
  return {
    url: resolvedRealmURL,
    async searchEntries(_searchEntryQuery: SearchEntryQuery) {
      let { realms: _realms, ...wireQuery } = rawPayload as Record<
        string,
        unknown
      >;
      let url = new URL('_search-v2', resolvedRealmURL);
      let response = await globalThis.fetch(url.href, {
        method: 'QUERY',
        headers: {
          Accept: SupportedMimeType.CardJson,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(wireQuery),
      });
      if (!response.ok) {
        let responseText = await response.text();
        throw new Error(
          `Remote realm search-v2 failed for ${resolvedRealmURL}: ${response.status} ${responseText}`,
        );
      }
      return (await response.json()) as SearchEntryCollectionDocument;
    },
  };
}

async function getRealmInfoForURL(realmURL: string): Promise<RealmInfo | null> {
  let registry = getTestRealmRegistry();
  let normalizedRealmURL = ensureTrailingSlash(realmURL);
  let registryEntry = registry.get(normalizedRealmURL);
  if (registryEntry?.realm) {
    let owner = registryEntry.adapter.owner as
      | { isDestroying?: boolean; isDestroyed?: boolean }
      | undefined;
    if (owner?.isDestroying || owner?.isDestroyed) {
      registry.delete(normalizedRealmURL);
    } else {
      let info = await registryEntry.realm.getRealmInfo();
      let realmConfig = await readRealmConfigFromAdapter(registryEntry.adapter);
      if (realmConfig) {
        info = applyRealmConfigOverrides(info, realmConfig);
      }
      return info;
    }
  }

  let resolvedRealmURL = resolveRemoteRealmURL(realmURL);
  if (isInProcessRealmURL(resolvedRealmURL)) {
    // In-process realm that isn't (yet) in the registry — e.g. its setup
    // hasn't run, or a prior test's destroyed-owner entry was just evicted.
    // There is no real server to fall back to, so report it as unavailable
    // rather than fetching a non-existent host.
    return null;
  }
  try {
    let response = await globalThis.fetch(`${resolvedRealmURL}_info`, {
      method: 'QUERY',
      headers: { Accept: SupportedMimeType.RealmInfo },
    });
    if (!response.ok) {
      return null;
    }
    let json = await response.json();
    return json.data.attributes as RealmInfo;
  } catch (error) {
    return null;
  }
}

async function readRealmConfigFromAdapter(
  adapter: TestRealmAdapter,
): Promise<Record<string, unknown> | null> {
  await adapter.ready;
  let fileRef = await adapter.openFile('realm.json');
  if (!fileRef || typeof fileRef.content !== 'string') {
    return null;
  }
  try {
    let card = JSON.parse(fileRef.content) as {
      data?: { attributes?: Record<string, unknown> };
    };
    let attrs = card?.data?.attributes ?? {};
    // Flatten the card shape into the legacy sidecar key-set so the
    // overrides applier doesn't need to know about cardInfo. `name`
    // lives under cardInfo on the card (matching the CardDef slot),
    // every other migrated key sits on attributes directly.
    let cardInfo = (attrs as { cardInfo?: { name?: unknown } }).cardInfo;
    return {
      ...attrs,
      ...(cardInfo && typeof cardInfo.name === 'string'
        ? { name: cardInfo.name }
        : {}),
    } as Record<string, unknown>;
  } catch (error) {
    console.warn(
      `[realm-server-mock] _info invalid realm config ${JSON.stringify({
        error: String(error),
      })}`,
    );
    return null;
  }
}

function applyRealmConfigOverrides(
  info: RealmInfo,
  realmConfig: Record<string, unknown>,
): RealmInfo {
  return {
    ...info,
    name: (realmConfig.name as string | null | undefined) ?? info.name,
    backgroundURL:
      (realmConfig.backgroundURL as string | null | undefined) ??
      info.backgroundURL,
    iconURL: (realmConfig.iconURL as string | null | undefined) ?? info.iconURL,
    showAsCatalog:
      (realmConfig.showAsCatalog as boolean | null | undefined) ??
      info.showAsCatalog,
    realmUserId:
      (realmConfig.realmUserId as string | null | undefined) ??
      info.realmUserId,
    publishable:
      (realmConfig.publishable as boolean | null | undefined) ??
      info.publishable,
    lastPublishedAt:
      (realmConfig.lastPublishedAt as string | Record<string, string> | null) ||
      info.lastPublishedAt,
  };
}

function resolveRemoteRealmURL(realmURL: string): string {
  let normalizedRealmURL = ensureTrailingSlash(realmURL);
  if (normalizedRealmURL.startsWith(baseRealm.url)) {
    return ensureTrailingSlash(ENV.resolvedBaseRealmURL);
  }
  return normalizedRealmURL;
}

// The realm server is mocked at ENV.realmServerURL (http://test-realm); realms
// under that origin are served in-process via the test-realm registry and have
// no listener on the real network. Only realms that resolve to a genuinely
// served origin — the base and skills realms on localhost:4201 — can be reached
// with a real fetch. A `globalThis.fetch` against an in-process realm always
// rejects with `TypeError: Failed to fetch`; besides the noise, that rejection
// can escape as an uncaught error and red an unrelated sibling test.
function isInProcessRealmURL(resolvedRealmURL: string): boolean {
  try {
    return (
      new URL(resolvedRealmURL).origin === new URL(ENV.realmServerURL).origin
    );
  } catch {
    return false;
  }
}
