import { Realm } from '@cardstack/runtime-common';
import { createResponse } from '@cardstack/runtime-common/create-response';
import { Loader } from '@cardstack/runtime-common/loader';
import log from 'loglevel';

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
      log.warn(`No realm is currently available`);
    } else if (this.realm.paths.inRealm(new URL(request.url))) {
      if (request.headers.get('Accept')?.includes('text/html')) {
        return createResponse(await this.realm.getIndexHTML(), {
          headers: { 'content-type': 'text/html' },
        });
      }
      let response = await this.realm.handle(request);
      if (response.status === 404) {
        // if we can't find the resource, then perhaps this is a request for the
        // backing web server, probably we should cache these... This is
        // intentionally layered such that requests for the realm server are
        // served first before trying the backing web server. This does mean
        // that the realm might clobber an asset that should be delivered by the
        // webserver--altho that is unlikely since those are mostly js chunks
        // with pretty random names.
        return await fetch(request);
      }
      return response;
    }

    return await Loader.fetch(request);
  }

  async dropCaches() {
    let names = await globalThis.caches.keys();
    for (let name of names) {
      await self.caches.delete(name);
    }

    if (this.realm) {
      await this.realm.searchIndex.run();
    }

    log.warn(`Caches dropped and search index rebuilt`);
    return new Response(`Caches dropped!`, {
      headers: {
        'content-type': 'text/html',
      },
    });
  }
}
