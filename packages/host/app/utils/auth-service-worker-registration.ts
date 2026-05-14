// Manages registration and token synchronization with the auth service worker.
//
// The auth service worker intercepts resource requests (images, CSS backgrounds)
// to realm servers and injects Authorization headers, solving the problem that
// <img> elements and CSS background-image: url(...) cannot send custom headers.

import { isTesting } from '@embroider/macros';

import window from 'ember-window-mock';

import { SessionLocalStorageKey } from './local-storage-keys';

function isServiceWorkerSupported(): boolean {
  return (
    !isTesting() &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator
  );
}

export async function registerAuthServiceWorker(): Promise<void> {
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

  // Respond to on-miss token lookups from the SW. The SW asks here when it
  // intercepts a GET to a known realm host but has no token in its in-memory
  // map (SW activation race, post-upload window before per-realm sync lands,
  // etc.). localStorage is the authoritative source of currently-valid
  // tokens — the SW's map is a derived cache.
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'request-realm-token') {
      return;
    }
    let port = event.ports?.[0];
    if (!port) {
      return;
    }
    let { realmURL, token } = resolveTokenForRequestURL(event.data.requestURL);
    port.postMessage({ realmURL, token });
  });

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
