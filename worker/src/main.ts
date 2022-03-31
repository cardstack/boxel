import { FetchHandler } from './fetch';

const worker = globalThis as unknown as ServiceWorkerGlobalScope;

const fetchHandler = new FetchHandler(worker);

worker.addEventListener('install', () => {
  // force moving on to activation even if another service worker had control
  worker.skipWaiting();
});

worker.addEventListener('activate', () => {
  // takes over when there is *no* existing service worker
  worker.clients.claim();
  console.log('activating service worker');
});

worker.addEventListener('message', (event) => {
  console.log(event);
  (async () => {
    for await (let item of event.data.handle.keys()) {
      console.log(item);
    }
  })()
});

worker.addEventListener('fetch', (event: FetchEvent) => {
  event.respondWith(fetchHandler.handleFetch(event.request));
});
