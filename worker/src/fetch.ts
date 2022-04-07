import { LivenessWatcher } from './liveness';
import { MessageHandler } from './message-handler';
import { readFile } from './util';

export class FetchHandler {
  private baseURL: string;
  private livenessWatcher: LivenessWatcher;
  private messageHandler: MessageHandler;

  constructor(worker: ServiceWorkerGlobalScope) {
    this.baseURL = worker.registration.scope;
    this.livenessWatcher = new LivenessWatcher(worker, async () => {
      await this.doCacheDrop();
    });
    this.messageHandler = new MessageHandler(worker);
  }

  async handleFetch(request: Request): Promise<Response> {
    try {
      if (!this.livenessWatcher.alive) {
        // if we're shutting down, let all requests pass through unchanged
        return await fetch(request);
      }

      let searchParams = new URL(request.url).searchParams;
      if (searchParams.get('dropcache') != null) {
        return await this.doCacheDrop();
      }

      let url = new URL(request.url);
      if (url.origin === 'http://local-realm') {
        return this.handleLocalRealm(request, url);
      }

      console.log(
        `Service worker on ${this.baseURL} passing through ${request.url}`
      );
      return fetch(request);
    } catch (err) {
      console.error(err);
      return new Response(`unexpected exception in service worker ${err}`, {
        status: 500,
      });
    }
  }

  private async handleLocalRealm(
    _request: Request,
    url: URL
  ): Promise<Response> {
    if (!this.messageHandler.fs) {
      return new Response('no local realm is available', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      });
    }
    try {
      let handle = await this.messageHandler.fs.getFileHandle(
        url.pathname.slice(1)
      );
      let content = await readFile(handle);
      return new Response(content, {
        status: 200,
        headers: {
          'content-type': 'text/javascript',
        },
      });
    } catch (err) {
      debugger;
      throw err;
    }
  }

  private async doCacheDrop() {
    let names = await globalThis.caches.keys();
    for (let name of names) {
      await self.caches.delete(name);
    }
    return new Response(`Caches dropped!`, {
      headers: {
        'content-type': 'text/html',
      },
    });
  }
}
