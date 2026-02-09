// Manages registration and token synchronization with the auth service worker.
//
// The auth service worker intercepts resource requests (images, CSS backgrounds)
// to realm servers and injects Authorization headers, solving the problem that
// <img> elements and CSS background-image: url(...) cannot send custom headers.

import { isTesting } from '@embroider/macros';

import window from 'ember-window-mock';

let registrationPromise: Promise<ServiceWorkerRegistration> | undefined;

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

  try {
    registrationPromise = navigator.serviceWorker.register(
      '/auth-service-worker.js',
      { scope: '/' },
    );
    await registrationPromise;

    // When a new service worker takes over, re-sync all tokens
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      let tokens = readTokensFromStorage();
      if (tokens) {
        syncAllTokensToServiceWorker(tokens);
      }
    });
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

const SESSION_LOCAL_STORAGE_KEY = 'boxel-session';

function readTokensFromStorage(): Record<string, string> | undefined {
  try {
    let sessionsString = window.localStorage.getItem(SESSION_LOCAL_STORAGE_KEY);
    if (sessionsString) {
      return JSON.parse(sessionsString);
    }
  } catch {
    // ignore parse errors
  }
  return undefined;
}
