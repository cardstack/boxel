import { getService } from '@universal-ember/test-support';

import type NetworkService from '@cardstack/host/services/network';

let swReady: Promise<void> | undefined;
let swRegistration: ServiceWorkerRegistration | undefined;

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

// Sets up a service worker that intercepts <img> requests to http://test-realm/
// and relays them to the VirtualNetwork so that browser-native resource loads
// (which bypass VirtualNetwork) can reach the test realm's files.
export function setupTestRealmServiceWorker(hooks: NestedHooks) {
  let handler: ((event: MessageEvent) => void) | undefined;

  hooks.beforeEach(async function () {
    if (!('serviceWorker' in navigator)) {
      return;
    }
    await ensureRegistered();

    let network = getService('network') as NetworkService;
    handler = async (event: MessageEvent) => {
      if (event.data?.type !== 'test-realm-fetch') {
        return;
      }
      let port = event.ports[0];
      if (!port) {
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
    };
    navigator.serviceWorker.addEventListener('message', handler);
  });

  hooks.afterEach(function () {
    if (handler) {
      navigator.serviceWorker.removeEventListener('message', handler);
      handler = undefined;
    }
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
