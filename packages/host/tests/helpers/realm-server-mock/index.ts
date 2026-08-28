import { getService } from '@universal-ember/test-support';

import {
  ensureTrailingSlash,
  testRealmURL,
  type RealmAction,
} from '@cardstack/runtime-common';

import type NetworkService from '@cardstack/host/services/network';
import type RealmServerService from '@cardstack/host/services/realm-server';

import {
  getRealmServerRoute,
  registerDefaultRoutes,
  resetCatalogRealmURL,
  resetLinkableRealms,
  setCatalogRealmURL,
  setLinkableRealms,
} from './routes';

export {
  resetCatalogRealmURL,
  resetLinkableRealms,
  setCatalogRealmURL,
  setLinkableRealms,
};

import type { EnsureSessionRoom, RealmServerMockState } from './types';

const realmServerHandlerStateSymbol = Symbol('test-realm-server-handler-state');
let sessionRoomEnsurer: EnsureSessionRoom | undefined;

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
      archivedRealms: new Map<string, { archivedAt: string }>(),
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
  let realmServer = getService('realm-server') as RealmServerService;
  void realmServer.fetchCatalogRealms();

  for (let [realmURL, permissions] of Object.entries(realmPermissions)) {
    state.realmPermissions.set(
      ensureTrailingSlash(realmURL),
      permissions as RealmAction[],
    );
  }
}

// Simulate a realm being archived or unarchived out of band (another tab, the
// CLI, an AI agent): flip its membership in the archived set that the mock's
// `_realm-auth` (active list) and `_archived-realms` endpoints read from,
// without the current session performing the mutation. Mirrors what
// handleArchiveToggle does when the POST endpoints are hit directly.
export function setRealmArchived(realmURL: string, archived: boolean) {
  let network = getService('network') as NetworkService;
  let state = ensureRealmServerMockState(network);
  let normalizedRealmURL = ensureTrailingSlash(realmURL);
  if (archived) {
    state.archivedRealms.set(normalizedRealmURL, {
      archivedAt: new Date().toISOString(),
    });
  } else {
    state.archivedRealms.delete(normalizedRealmURL);
  }
}

// Simulate a trusted realm server going unreachable (or recovering) at its
// `_realm-auth` endpoint, so boot-assembly graceful-degradation and retry can
// be exercised deterministically.
export function setRealmAuthFailure(shouldFail: boolean) {
  let network = getService('network') as NetworkService;
  let state = ensureRealmServerMockState(network);
  state.failRealmAuth = shouldFail;
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
