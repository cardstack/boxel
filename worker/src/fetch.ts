import { Realm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

export class FetchHandler {
  private realm: Realm | undefined;

  constructor(private livenessWatcher?: { alive: boolean }) {}

  addRealm(realm: Realm) {
    this.realm = realm;
  }

  async handleFetch(request: Request): Promise<Response> {
    if (this.livenessWatcher && !this.livenessWatcher.alive) {
      // if we're shutting down, let all requests pass through unchanged
      return await fetch(request);
    }

    let searchParams = new URL(request.url).searchParams;
    if (searchParams.get('dropcache') != null) {
      return await this.dropCaches();
    }

    if (!this.realm) {
      console.warn(`No realm is currently available`);
    } else if (this.realm.paths.inRealm(new URL(request.url))) {
      return await this.realm.handle(request);
    }

    console.log(
      `Service worker passing through ${request.url} for ${request.referrer}`
    );
    return await Loader.fetch(request);
  }

  async dropCaches() {
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
