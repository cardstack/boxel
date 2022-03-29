const worker = globalThis as unknown as ServiceWorkerGlobalScope;

worker.addEventListener('install', () => {
  // force moving on to activation even if another service worker had control
  worker.skipWaiting();
});

worker.addEventListener('activate', () => {
  // takes over when there is *no* existing service worker
  worker.clients.claim();
  console.log('activating service worker');
});

worker.addEventListener('fetch', (event: FetchEvent) => {
  console.log(`SAW fetch ${event.request.url}`);
  event.respondWith(fetch(event.request));
});
