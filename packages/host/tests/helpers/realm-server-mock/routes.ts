import {
  buildSearchErrorResponse,
  combinePrerenderedSearchResults,
  combineSearchResults,
  baseRealm,
  parseRealmsParam,
  parsePrerenderedSearchRequestFromRequest,
  parseSearchQueryFromRequest,
  SearchRequestError,
  searchPrerenderedRealms,
  searchRealms,
  SupportedMimeType,
} from '@cardstack/runtime-common';

import { getRoomIdForRealmAndUser } from '../mock-matrix/_utils';
import { createJWT, testRealmSecretSeed } from '../test-auth';
import { getTestRealmRegistry } from '../test-realm-registry';

import {
  buildPrerenderedDocFromCards,
  buildSearchDocFromCards,
  catalogRealmURL,
  filterBaseRealmCards,
  filterCatalogRealmCards,
} from './fixtures';

import type { RealmServerMockRoute, RealmServerMockState } from './types';

const TEST_MATRIX_USER = '@testuser:localhost';

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
  registerAuthRoutes();
  registerCatalogRoutes();
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

      let registry = getTestRealmRegistry();
      let combined = await searchRealms(
        realmList.map((realmURL) => registry.get(realmURL)?.realm),
        cardsQuery,
      );
      let extraDocs = [] as ReturnType<typeof buildSearchDocFromCards>[];
      if (realmList.includes(baseRealm.url)) {
        let baseCards = filterBaseRealmCards(cardsQuery);
        if (baseCards.length > 0) {
          extraDocs.push(buildSearchDocFromCards(baseCards));
        }
      }
      if (realmList.includes(catalogRealmURL)) {
        let catalogCards = filterCatalogRealmCards(cardsQuery);
        if (catalogCards.length > 0) {
          extraDocs.push(buildSearchDocFromCards(catalogCards));
        }
      }
      if (extraDocs.length > 0) {
        combined = combineSearchResults([combined, ...extraDocs]);
      }

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

      let registry = getTestRealmRegistry();
      let combined = await searchPrerenderedRealms(
        realmList.map((realmURL) => registry.get(realmURL)?.realm),
        parsed.cardsQuery,
        {
          htmlFormat: parsed.htmlFormat,
          cardUrls: parsed.cardUrls,
          renderType: parsed.renderType,
        },
      );
      let extraDocs = [] as ReturnType<typeof buildPrerenderedDocFromCards>[];
      if (realmList.includes(baseRealm.url)) {
        let baseCards = filterBaseRealmCards(parsed.cardsQuery);
        if (baseCards.length > 0) {
          extraDocs.push(buildPrerenderedDocFromCards(baseCards));
        }
      }
      if (realmList.includes(catalogRealmURL)) {
        let catalogCards = filterCatalogRealmCards(parsed.cardsQuery);
        if (catalogCards.length > 0) {
          extraDocs.push(buildPrerenderedDocFromCards(catalogCards));
        }
      }
      if (extraDocs.length > 0) {
        combined = combinePrerenderedSearchResults([combined, ...extraDocs]);
      }

      return new Response(JSON.stringify(combined), {
        status: 200,
        headers: { 'content-type': SupportedMimeType.CardJson },
      });
    },
  });
}

function registerAuthRoutes() {
  registerRealmServerRoute({
    path: '/_realm-auth',
    handler: async (_req, _url, state: RealmServerMockState) => {
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

function registerCatalogRoutes() {
  registerRealmServerRoute({
    path: '/_catalog-realms',
    handler: async () => {
      return new Response(
        JSON.stringify({
          data: [
            {
              type: 'catalog-realm',
              id: catalogRealmURL,
              attributes: {},
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': SupportedMimeType.JSONAPI },
        },
      );
    },
  });
}
