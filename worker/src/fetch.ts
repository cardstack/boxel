import { CardError } from '@cardstack/runtime-common/error';
import { generateExternalStub } from '@cardstack/runtime-common/externals';
import { Realm, baseRealm } from '@cardstack/runtime-common';

export class FetchHandler {
  private realm: Realm | undefined;

  constructor(private livenessWatcher?: { alive: boolean }) {}

  addRealm(realm: Realm) {
    this.realm = realm;
  }

  async handleFetch(request: Request): Promise<Response> {
    try {
      if (this.livenessWatcher && !this.livenessWatcher.alive) {
        // if we're shutting down, let all requests pass through unchanged
        return await fetch(request);
      }

      let searchParams = new URL(request.url).searchParams;
      if (searchParams.get('dropcache') != null) {
        return await this.dropCaches();
      }

      let url = new URL(request.url);

      // TODO Create a BaseRealm that extends Realm that handles all the
      // requests for the base realm -- this can be scaffolding for now, but it
      // should exercise the Realm API
      if (baseRealm.inRealm(url)) {
        return generateExternalStub(
          url.pathname.replace('/base/', 'runtime-spike/lib/')
        );
      }
      if (!this.realm) {
        console.warn(`No realm is currently available`);
      } else if (url.href.includes(this.realm.url)) {
        return await this.realm.handle(request);
      }
      if (url.origin === 'http://externals') {
        return generateExternalStub(url.pathname.slice(1));
      }

      console.log(`Service worker passing through ${request.url}`);
      return await fetch(request);
    } catch (err) {
      if (err instanceof CardError) {
        return err.response;
      }
      console.error(err);
      return new Response(`unexpected exception in service worker ${err}`, {
        status: 500,
      });
    }
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
