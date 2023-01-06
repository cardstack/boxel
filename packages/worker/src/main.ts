import { FetchHandler } from './fetch';
import { LivenessWatcher } from './liveness';
import { MessageHandler } from './message-handler';
import { LocalRealm } from './local-realm';
import { Realm, baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';
import '@cardstack/runtime-common/externals-global';

const worker = globalThis as unknown as ServiceWorkerGlobalScope;

const livenessWatcher = new LivenessWatcher(worker);
const messageHandler = new MessageHandler(worker);
const fetchHandler = new FetchHandler(livenessWatcher);

livenessWatcher.registerShutdownListener(async () => {
  await fetchHandler.dropCaches();
});

// This is the locally served base realm
Loader.addURLMapping(
  new URL(baseRealm.url),
  new URL('http://localhost:4201/base/')
);

// TODO: this should be a more event-driven capability driven from the message
// handler
(async () => {
  try {
    await messageHandler.startingUp;
    if (!messageHandler.fs) {
      throw new Error(`could not get FileSystem`);
    }
    let realm = new Realm(
      'http://local-realm/',
      new LocalRealm(messageHandler.fs),
      ({ getRunState, setRunState, staticResponses }) => {
        messageHandler.setup(getRunState, setRunState);
        return async (path: string) => {
          return await messageHandler.visit(path, staticResponses);
        };
      }
    );
    fetchHandler.addRealm(realm);
  } catch (err) {
    console.log(err);
  }
})();

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
  event.respondWith(fetchHandler.handleFetch(event.request));
});
