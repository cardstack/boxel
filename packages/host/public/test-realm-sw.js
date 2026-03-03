// Service worker that relays requests to test-realm URLs back to the main
// thread so the VirtualNetwork can serve them.  Only registered during tests.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (!event.request.url.startsWith('http://test-realm/')) {
    return;
  }
  event.respondWith(relayToClient(event));
});

async function relayToClient(event) {
  let client = await resolveClient(event);
  if (!client) {
    return new Response('No client available', { status: 503 });
  }

  return new Promise((resolve) => {
    let channel = new MessageChannel();
    channel.port1.onmessage = (msg) => {
      let { status, headers, body } = msg.data;
      resolve(new Response(body, { status, headers }));
    };
    client.postMessage({ type: 'test-realm-fetch', url: event.request.url }, [
      channel.port2,
    ]);
  });
}

async function resolveClient(event) {
  // event.clientId may be empty for cross-origin subresource requests.
  if (event.clientId) {
    let directClient = await self.clients.get(event.clientId);
    if (directClient) {
      return directClient;
    }
  }

  // This is usually set for navigations but can occasionally help when
  // clientId is missing.
  if (event.resultingClientId) {
    let resultingClient = await self.clients.get(event.resultingClientId);
    if (resultingClient) {
      return resultingClient;
    }
  }

  let allClients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  if (!allClients.length) {
    return undefined;
  }

  // Prefer the visible/focused test runner tab over arbitrary ordering.
  allClients.sort((a, b) => scoreClient(b) - scoreClient(a));
  return allClients[0];
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
