import { FetchHandler } from './fetch';
import { MessageHandler } from './message-handler';

const worker = globalThis as unknown as ServiceWorkerGlobalScope;

const fetchHandler = new FetchHandler(worker);
const messageHandler = new MessageHandler();

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
  messageHandler.handle(event);
});

worker.addEventListener('fetch', (event: FetchEvent) => {
  event.respondWith(fetchHandler.handleFetch(event.request));
});
