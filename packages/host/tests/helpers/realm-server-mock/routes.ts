import {
  buildSearchErrorResponse,
  baseRealm,
  ensureTrailingSlash,
  parseRealmsParam,
  parsePrerenderedSearchRequestFromRequest,
  parseSearchQueryFromRequest,
  SearchRequestError,
  searchPrerenderedRealms,
  searchRealms,
  SupportedMimeType,
  type RealmInfo,
  type Query,
} from '@cardstack/runtime-common';

import type {
  CardCollectionDocument,
  PrerenderedCardCollectionDocument,
} from '@cardstack/runtime-common/document-types';

import ENV from '@cardstack/host/config/environment';

import { getRoomIdForRealmAndUser } from '../mock-matrix/_utils';
import { createJWT, testRealmSecretSeed } from '../test-auth';
import { getTestRealmRegistry } from '../test-realm-registry';

import type { RealmServerMockRoute, RealmServerMockState } from './types';

const TEST_MATRIX_USER = '@testuser:localhost';

type SearchableRealm = {
  url?: string;
  search: (query: Query) => Promise<CardCollectionDocument>;
  searchPrerendered: (
    query: Query,
    opts: Pick<
      Awaited<ReturnType<typeof parsePrerenderedSearchRequestFromRequest>>,
      'htmlFormat' | 'cardUrls' | 'renderType'
    >,
  ) => Promise<PrerenderedCardCollectionDocument>;
};

const remoteRealmCache = new Map<string, SearchableRealm>();

const realmServerRoutes = new Map<string, RealmServerMockRoute>();

function normalizeRoutePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function registerRealmServerRoute(route: RealmServerMockRoute) {
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
  registerCatalogRoutes();
  registerAuthRoutes();
}

function registerSearchRoutes() {
  registerRealmServerRoute({
    path: '/_search',
    handler: async (req, url) => {
      let realmList = parseRealmsParam(url);

      if (realmList.length === 0) {
        return buildSearchErrorResponse('realms query param must be supplied');
      }

      let cardsQuery;
      try {
        cardsQuery = await parseSearchQueryFromRequest(req.clone());
      } catch (e) {
        if (e instanceof SearchRequestError) {
          return buildSearchErrorResponse(e.message);
        }
        throw e;
      }

      let combined = await searchRealms(
        realmList.map((realmURL) => getSearchableRealmForURL(realmURL)),
        cardsQuery,
      );

      return new Response(JSON.stringify(combined), {
        status: 200,
        headers: { 'content-type': SupportedMimeType.CardJson },
      });
    },
  });

  registerRealmServerRoute({
    path: '/_search-prerendered',
    handler: async (req, url) => {
      let realmList = parseRealmsParam(url);

      if (realmList.length === 0) {
        return buildSearchErrorResponse('realms query param must be supplied');
      }

      let parsed;
      try {
        parsed = await parsePrerenderedSearchRequestFromRequest(req.clone());
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
    path: '/_info',
    handler: async (_req, url) => {
      let realmList = parseRealmsParam(url);

      if (realmList.length === 0) {
        return new Response(
          JSON.stringify({
            errors: ['realms query param must be supplied'],
          }),
          {
            status: 400,
            headers: { 'content-type': SupportedMimeType.JSONAPI },
          },
        );
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

function registerCatalogRoutes() {
  registerRealmServerRoute({
    path: '/_catalog-realms',
    handler: async () => {
      let catalogURLs = [
        ENV.resolvedCatalogRealmURL,
        ENV.resolvedSkillsRealmURL,
      ]
        .filter(Boolean)
        .map((url) => ensureTrailingSlash(url));
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
      return (await response.json()) as CardCollectionDocument;
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

async function getRealmInfoForURL(realmURL: string): Promise<RealmInfo | null> {
  let registry = getTestRealmRegistry();
  let registryEntry = registry.get(ensureTrailingSlash(realmURL));
  if (registryEntry?.realm) {
    return await registryEntry.realm.getRealmInfo();
  }

  let resolvedRealmURL = resolveRemoteRealmURL(realmURL);
  let response = await globalThis.fetch(`${resolvedRealmURL}_info`, {
    headers: { Accept: SupportedMimeType.RealmInfo },
  });
  if (!response.ok) {
    return null;
  }
  let json = await response.json();
  return json.data.attributes as RealmInfo;
}

function resolveRemoteRealmURL(realmURL: string): string {
  let normalizedRealmURL = ensureTrailingSlash(realmURL);
  if (normalizedRealmURL.startsWith(baseRealm.url)) {
    return ensureTrailingSlash(ENV.resolvedBaseRealmURL);
  }
  return normalizedRealmURL;
}
