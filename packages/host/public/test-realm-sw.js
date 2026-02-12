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
  // event.clientId may be empty for cross-origin subresource requests
  let client = await self.clients.get(event.clientId);
  if (!client) {
    let allClients = await self.clients.matchAll({ type: 'window' });
    client = allClients[0];
  }
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
