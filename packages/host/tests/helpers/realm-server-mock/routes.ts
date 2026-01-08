import {
  buildSearchErrorResponse,
  ensureTrailingSlash,
  parseRealmsParam,
  parsePrerenderedSearchRequestFromRequest,
  parseSearchQueryFromRequest,
  SearchRequestError,
  searchPrerenderedRealms,
  searchRealms,
  SupportedMimeType,
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
  return undefined;
}
