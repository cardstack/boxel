import { getContext } from '@ember/test-helpers';

import type NetworkService from '@cardstack/host/services/network';

let swReady: Promise<void> | undefined;
let swRegistration: ServiceWorkerRegistration | undefined;
let globalResponderInstalled = false;

async function ensureRegistered(): Promise<void> {
  if (swReady) {
    return swReady;
  }
  swReady = (async () => {
    let reg = await navigator.serviceWorker.register('/test-realm-sw.js');
    swRegistration = reg;
    let sw = reg.installing || reg.waiting || reg.active;
    if (sw && sw.state !== 'activated') {
      await new Promise<void>((resolve) => {
        sw!.addEventListener('statechange', function handler() {
          if (sw!.state === 'activated') {
            sw!.removeEventListener('statechange', handler);
            resolve();
          }
        });
      });
    }
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          () => resolve(),
          { once: true },
        );
      });
    }
  })();
  return swReady;
}

// test-realm-sw.js relays every browser-level fetch to http://test-realm/ back to
// the window via postMessage and answers 503 ("No responsive client available")
// if nothing replies within its 1500ms timeout. An active service worker keeps
// controlling the already-loaded page after `unregister()` — until the page
// unloads — so once any module registers it, it lingers and intercepts
// test-realm fetches in later modules too. Binding the responder per-module
// meant those later modules had no responder, so their escaped test-realm
// fetches timed out and 503'd, cascading whole modules into failure.
//
// Install a single, never-removed responder that resolves the CURRENT test's
// network service at message time (rather than capturing one per module), so a
// lingering worker always finds a responsive client no matter which module is
// running. Install-once + no removal mirrors the other global test hooks; a
// stray worker only ever posts one `test-realm-fetch` message per request, so a
// single listener is sufficient.
export function installTestRealmFetchResponderOnce(): void {
  if (globalResponderInstalled || !('serviceWorker' in navigator)) {
    return;
  }
  globalResponderInstalled = true;
  navigator.serviceWorker.addEventListener(
    'message',
    async (event: MessageEvent) => {
      if (event.data?.type !== 'test-realm-fetch') {
        return;
      }
      let port = event.ports[0];
      if (!port) {
        return;
      }
      let owner = (
        getContext() as
          | { owner?: { lookup(name: string): unknown } }
          | undefined
      )?.owner;
      let network = owner?.lookup('service:network') as
        | NetworkService
        | undefined;
      if (!network) {
        // No test currently owns the app (e.g. between tests). Answer right
        // away so the worker doesn't burn its full timeout waiting on a reply
        // that can't come.
        port.postMessage({ status: 503, headers: {}, body: null });
        return;
      }
      try {
        let response = await network.virtualNetwork.fetch(event.data.url);
        let body = await response.arrayBuffer();
        let headers: Record<string, string> = {};
        response.headers.forEach((v, k) => {
          headers[k] = v;
        });
        port.postMessage({ status: response.status, headers, body }, [body]);
      } catch {
        port.postMessage({ status: 500, headers: {}, body: null });
      }
    },
  );
}

// Sets up a service worker that intercepts <img> requests to http://test-realm/
// and relays them to the VirtualNetwork so that browser-native resource loads
// (which bypass VirtualNetwork) can reach the test realm's files. The relay
// responder is installed globally (see installTestRealmFetchResponderOnce) so it
// keeps answering even after this module tears down and the worker lingers.
export function setupTestRealmServiceWorker(hooks: NestedHooks) {
  hooks.beforeEach(async function () {
    if (!('serviceWorker' in navigator)) {
      return;
    }
    installTestRealmFetchResponderOnce();
    await ensureRegistered();
  });

  // Unregister the test-realm SW after the module's tests complete so it
  // doesn't persist and replace the auth service worker (which would break
  // the app if the user navigates from /tests back to / during ember serve).
  hooks.after(async function () {
    if (swRegistration) {
      await swRegistration.unregister();
      swRegistration = undefined;
      swReady = undefined;
    }
  });
}
