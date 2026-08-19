// Manages registration and token synchronization with the auth service worker.
//
// The auth service worker intercepts resource requests (images, CSS backgrounds)
// to realm servers and injects Authorization headers, solving the problem that
// <img> elements and CSS background-image: url(...) cannot send custom headers.

import { isTesting } from '@embroider/macros';

import window from 'ember-window-mock';

import { SessionLocalStorageKey } from './local-storage-keys';

// Structural so tests can stub without the full service surface.
export interface AuthServiceWorkerDeps {
  realmService: {
    realmOf(input: URL): string | undefined;
    reauthenticate(realmURL: string): Promise<string | undefined>;
  };
  matrixService: {
    readonly isLoggedIn: boolean;
  };
}

export function isServiceWorkerSupported(): boolean {
  return (
    !isTesting() &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator
  );
}

export async function registerAuthServiceWorker(
  deps: AuthServiceWorkerDeps,
): Promise<void> {
  if (!isServiceWorkerSupported()) {
    return;
  }

  // Listen for controller changes BEFORE registration so we don't miss the
  // event if the SW activates and calls clients.claim() quickly.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    let tokens = readTokensFromStorage();
    if (tokens) {
      syncAllTokensToServiceWorker(tokens);
    }
  });

  navigator.serviceWorker.addEventListener(
    'message',
    createTokenRequestHandler(deps),
  );

  try {
    await navigator.serviceWorker.register('/auth-service-worker.js', {
      scope: '/',
    });

    // If a controller already exists (SW was previously registered), sync
    // tokens immediately since controllerchange won't fire.
    if (navigator.serviceWorker.controller) {
      let tokens = readTokensFromStorage();
      if (tokens) {
        syncAllTokensToServiceWorker(tokens);
      }
    }
  } catch (e) {
    console.warn('Failed to register auth service worker:', e);
  }
}

export function createTokenRequestHandler(deps: AuthServiceWorkerDeps) {
  return async (event: MessageEvent) => {
    if (!event.data || event.data.type !== 'request-realm-token') {
      return;
    }
    let port = event.ports?.[0];
    if (!port) {
      return;
    }
    let requestURL: string | undefined = event.data.requestURL;

    let { realmURL, token } = resolveTokenForRequestURL(requestURL);
    if (realmURL && token) {
      port.postMessage({ realmURL, token });
      return;
    }

    let owningRealm: string | undefined;
    if (requestURL) {
      try {
        owningRealm = deps.realmService.realmOf(new URL(requestURL));
      } catch {
        owningRealm = undefined;
      }
    }
    if (!owningRealm || !deps.matrixService.isLoggedIn) {
      port.postMessage({});
      return;
    }

    // Tell the SW to use its refresh budget; reauthenticate is single-flighted
    // per realm and syncs the new token to the SW as a side effect.
    try {
      port.postMessage({ type: 'pending' });
    } catch {
      return;
    }
    try {
      let refreshed = await deps.realmService.reauthenticate(owningRealm);
      port.postMessage(
        refreshed ? { realmURL: owningRealm, token: refreshed } : {},
      );
    } catch {
      try {
        port.postMessage({});
      } catch {
        // port closed (page navigated)
      }
    }
  };
}

export function syncTokenToServiceWorker(
  realmURL: string,
  token: string | undefined,
): void {
  if (!isServiceWorkerSupported()) {
    return;
  }

  let controller = navigator.serviceWorker.controller;
  if (!controller) {
    // SW not yet active — tokens will be synced via controllerchange or
    // the post-registration sync in registerAuthServiceWorker.
    return;
  }

  if (token) {
    controller.postMessage({
      type: 'set-realm-token',
      realmURL,
      token,
    });
  } else {
    controller.postMessage({
      type: 'remove-realm-token',
      realmURL,
    });
  }
}

export function syncAllTokensToServiceWorker(
  tokens: Record<string, string>,
): void {
  if (!isServiceWorkerSupported()) {
    return;
  }

  let controller = navigator.serviceWorker.controller;
  if (!controller) {
    return;
  }

  controller.postMessage({
    type: 'sync-tokens',
    tokens,
  });
}

export function clearServiceWorkerTokens(): void {
  if (!isServiceWorkerSupported()) {
    return;
  }

  let controller = navigator.serviceWorker.controller;
  if (!controller) {
    return;
  }

  controller.postMessage({ type: 'clear-tokens' });
}

function readTokensFromStorage(): Record<string, string> | undefined {
  try {
    let sessionsString = window.localStorage.getItem(SessionLocalStorageKey);
    if (sessionsString) {
      return JSON.parse(sessionsString);
    }
  } catch {
    // ignore parse errors
  }
  return undefined;
}

// Find the longest realm-URL prefix in localStorage that matches the given
// request URL. Returns `undefined` for both fields when nothing matches —
// the SW will then preserve its existing pass-through behavior for that
// request.
function resolveTokenForRequestURL(requestURL: string | undefined): {
  realmURL?: string;
  token?: string;
} {
  if (!requestURL) {
    return {};
  }
  let tokens = readTokensFromStorage();
  if (!tokens) {
    return {};
  }
  let bestRealmURL: string | undefined;
  for (let realmURL of Object.keys(tokens)) {
    if (
      requestURL.startsWith(realmURL) &&
      (!bestRealmURL || realmURL.length > bestRealmURL.length)
    ) {
      bestRealmURL = realmURL;
    }
  }
  if (!bestRealmURL) {
    return {};
  }
  return { realmURL: bestRealmURL, token: tokens[bestRealmURL] };
}
