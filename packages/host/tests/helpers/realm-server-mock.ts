import { getService } from '@universal-ember/test-support';

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
  testRealmURL,
  type RealmAction,
} from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';
import type NetworkService from '@cardstack/host/services/network';

import { getRoomIdForRealmAndUser } from './mock-matrix/_utils';
import { createJWT, testRealmSecretSeed } from './test-auth';
import { getTestRealmRegistry } from './test-realm-registry';

// Host tests mock realm-server endpoints here (e.g. /_search, /_realm-auth,
// /_server-session, etc.) to avoid wiring up a real realm server in
// acceptance/integration tests.
const realmServerHandlerStateSymbol = Symbol('test-realm-server-handler-state');
const TEST_MATRIX_USER = '@testuser:localhost';

type RealmServerMockRouteHandler = (
  req: Request,
  url: URL,
  state: RealmServerMockState,
) => Promise<Response | null>;

type RealmServerMockRoute = {
  path: string;
  handler: RealmServerMockRouteHandler;
};

type EnsureSessionRoom = (
  realmURL: string,
  userId: string,
) => Promise<void> | void;

type RealmServerMockState = {
  handler: (req: Request) => Promise<Response | null>;
  realmPermissions: Map<string, RealmAction[]>;
  mountedVirtualNetwork?: unknown;
  ensureSessionRoom?: EnsureSessionRoom;
};

const realmServerRoutes = new Map<string, RealmServerMockRoute>();
let sessionRoomEnsurer: EnsureSessionRoom | undefined;

function normalizeRoutePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function registerRealmServerRoute(route: RealmServerMockRoute) {
  realmServerRoutes.set(normalizeRoutePath(route.path), route);
}

function getRealmServerRoute(url: URL): RealmServerMockRoute | undefined {
  return realmServerRoutes.get(url.pathname);
}

function registerDefaultRoutes() {
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

      return new Response(JSON.stringify(combined), {
        status: 200,
        headers: { 'content-type': SupportedMimeType.CardJson },
      });
    },
  });

  registerRealmServerRoute({
    path: '/_realm-auth',
    handler: async (_req, _url, state) => {
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

  registerRealmServerRoute({
    path: '/_catalog-realms',
    handler: async () => {
      let catalogRealmURL = ensureTrailingSlash(ENV.resolvedCatalogRealmURL);
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

registerDefaultRoutes();

async function handleRealmServerMockRequest(
  req: Request,
  state: RealmServerMockState,
): Promise<Response | null> {
  let url = new URL(req.url);
  let route = getRealmServerRoute(url);
  if (!route) {
    return null;
  }
  return route.handler(req, url, state);
}

function ensureRealmServerMockState(
  network: NetworkService,
): RealmServerMockState {
  let state = (network as any)[realmServerHandlerStateSymbol] as
    | RealmServerMockState
    | undefined;
  if (!state) {
    let realmPermissions = new Map<string, RealmAction[]>();
    let handler = async (req: Request) => {
      let currentState = (network as any)[realmServerHandlerStateSymbol] as
        | RealmServerMockState
        | undefined;
      if (!currentState) {
        return null;
      }
      return handleRealmServerMockRequest(req, currentState);
    };
    state = {
      realmPermissions,
      handler,
      ensureSessionRoom: sessionRoomEnsurer,
    };
    (network as any)[realmServerHandlerStateSymbol] = state;
  }
  if (state.mountedVirtualNetwork !== network.virtualNetwork) {
    network.mount(state.handler, { prepend: true });
    state.mountedVirtualNetwork = network.virtualNetwork;
  }
  return state;
}

export function setupAuthEndpoints(
  realmPermissions: Record<string, RealmAction[]> = {
    [testRealmURL]: ['read', 'write'],
  },
) {
  let network = getService('network') as NetworkService;
  let state = ensureRealmServerMockState(network);

  for (let [realmURL, permissions] of Object.entries(realmPermissions)) {
    state.realmPermissions.set(
      ensureTrailingSlash(realmURL),
      permissions as RealmAction[],
    );
  }
}

export function registerRealmAuthSessionRoomEnsurer(
  callback: EnsureSessionRoom,
) {
  sessionRoomEnsurer = callback;
  let network = getService('network') as NetworkService;
  let state = (network as any)[realmServerHandlerStateSymbol] as
    | RealmServerMockState
    | undefined;
  if (state) {
    state.ensureSessionRoom = callback;
  }
}
