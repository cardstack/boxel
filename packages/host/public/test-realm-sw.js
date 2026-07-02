// Service worker that relays requests to test-realm URLs back to the main
// thread so the VirtualNetwork can serve them.  Only registered during tests.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Interception is opt-in per module. `unregister()` does not evict an already
// active worker from a still-loaded page, so once a module registers this SW it
// keeps controlling the QUnit runner into later modules. If it kept intercepting
// there, those modules (which never installed a `test-realm-fetch` responder)
// would get a 503 for every test-realm fetch and cascade. Gating on `active`
// lets a module turn interception on for its own tests and off on teardown, so a
// lingering worker passes requests straight through — behaving exactly as if no
// SW were installed, which is the state non-intercepting modules expect.
//
// Default off so a cold-started/terminated-and-restarted worker (which loses
// this in-memory flag) fails safe toward passthrough rather than resurrecting
// the leak; the owning module re-asserts `active` in its beforeEach.
let active = false;

self.addEventListener('message', (event) => {
  let data = event.data;
  if (!data || data.type !== 'test-realm-sw-set-active') {
    return;
  }
  active = Boolean(data.active);
  let port = event.ports && event.ports[0];
  if (port) {
    port.postMessage({ ok: true, active });
  }
});

self.addEventListener('fetch', (event) => {
  if (!active) {
    return;
  }
  if (!event.request.url.startsWith('http://test-realm/')) {
    return;
  }
  event.respondWith(relayToClient(event));
});

async function relayToClient(event) {
  let clients = await resolveClients(event);
  if (!clients.length) {
    return new Response('No client available', { status: 503 });
  }

  for (let client of clients) {
    let response = await relayViaClient(client, event.request.url);
    if (response) {
      return response;
    }
  }

  return new Response('No responsive client available', { status: 503 });
}

async function resolveClients(event) {
  let orderedClients = [];

  // event.clientId may be empty for cross-origin subresource requests.
  if (event.clientId) {
    let directClient = await self.clients.get(event.clientId);
    if (directClient) {
      orderedClients.push(directClient);
    }
  }

  // This is usually set for navigations but can occasionally help when
  // clientId is missing.
  if (event.resultingClientId) {
    let resultingClient = await self.clients.get(event.resultingClientId);
    if (
      resultingClient &&
      !orderedClients.some((client) => client.id === resultingClient.id)
    ) {
      orderedClients.push(resultingClient);
    }
  }

  let allClients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  if (!allClients.length) {
    return orderedClients;
  }

  // Prefer the visible/focused test runner tab over arbitrary ordering.
  allClients.sort((a, b) => scoreClient(b) - scoreClient(a));
  for (let client of allClients) {
    if (!orderedClients.some((existing) => existing.id === client.id)) {
      orderedClients.push(client);
    }
  }

  return orderedClients;
}

async function relayViaClient(client, url) {
  let timeoutMs = 1500;
  return await new Promise((resolve) => {
    let channel = new MessageChannel();
    let settled = false;

    let finish = (response) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      // Release MessageChannel resources promptly.
      if (channel.port1) {
        channel.port1.onmessage = null;
        try {
          channel.port1.close();
        } catch {
          // Ignore errors when closing an already-closed port.
        }
      }
      if (channel.port2) {
        try {
          channel.port2.close();
        } catch {
          // Ignore errors when closing an already-closed port.
        }
      }
      resolve(response);
    };

    let timeout = setTimeout(() => finish(undefined), timeoutMs);

    channel.port1.onmessage = (msg) => {
      let { status, headers, body } = msg.data ?? {};
      if (typeof status !== 'number') {
        finish(undefined);
        return;
      }
      let responseHeaders = new Headers(headers ?? {});
      responseHeaders.set('x-test-realm-sw-client-id', client.id ?? 'unknown');
      responseHeaders.set(
        'x-test-realm-sw-client-url',
        client.url ?? 'unknown',
      );
      responseHeaders.set(
        'x-test-realm-sw-client-focused',
        String(Boolean(client.focused)),
      );
      responseHeaders.set(
        'x-test-realm-sw-client-visibility',
        client.visibilityState ?? 'unknown',
      );
      finish(new Response(body, { status, headers: responseHeaders }));
    };

    try {
      client.postMessage({ type: 'test-realm-fetch', url }, [channel.port2]);
    } catch {
      finish(undefined);
    }
  });
}

function scoreClient(client) {
  let score = 0;
  if (client.url && client.url.includes('/tests')) {
    score += 4;
  }
  if (client.visibilityState === 'visible') {
    score += 2;
  }
  if (client.focused) {
    score += 1;
  }
  return score;
}
