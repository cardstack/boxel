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
      resolve(response);
    };

    let timeout = setTimeout(() => finish(undefined), timeoutMs);

    channel.port1.onmessage = (msg) => {
      let { status, headers, body } = msg.data ?? {};
      if (typeof status !== 'number') {
        finish(undefined);
        return;
      }
      finish(new Response(body, { status, headers }));
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
