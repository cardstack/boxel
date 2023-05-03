import { Realm, logger } from '@cardstack/runtime-common';
import { createResponse } from '@cardstack/runtime-common/create-response';
import { Loader } from '@cardstack/runtime-common/loader';

const log = logger('worker:fetch');

export class FetchHandler {
  private realm: Realm | undefined;
  private otherRealmsServed: string[] | undefined;

  constructor(private livenessWatcher?: { alive: boolean }) {}

  async waitForReadiness() {
    if (this.realm) {
      await this.realm.ready;
    }
  }

  addRealm(realm: Realm) {
    this.realm = realm;
  }

  setRealmsServed(otherRealmsServed: string[]) {
    this.otherRealmsServed = otherRealmsServed.map((u) =>
      Loader.resolve(u).href.replace(/\/$/, '')
    );
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
      if (new URL(request.url).pathname === '/tests') {
        // allow tests requests to go back to the ember-cli server
        return await fetch(request);
      }
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

    // this is to work around an issue where the loader running within the
    // service worker does not seem to be able to deal with a redirect
    // correctly. When a redirect is issued for visiting a realm without a
    // trailing slash, the service worker will cancel the request and the
    // browser will show an "page can't load" error (the network logs show both
    // a network error and a successful redirect request for the url in
    // question). This happens when you are using the local realm and you decide
    // to switch to a hosted realm on the same server, the very first request
    // for the hosted realm will be handled here in the service worker.
    if (this.otherRealmsServed?.includes(request.url)) {
      return await fetch(request);
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
