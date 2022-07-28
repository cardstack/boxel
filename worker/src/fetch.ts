import { CardError } from '@cardstack/runtime-common/error';
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

      let urlWithoutQuery = new URL(request.url);
      // chop off the query string from the URL so we can look at the route specifically
      urlWithoutQuery = new URL(urlWithoutQuery.pathname, urlWithoutQuery);

      if (baseRealm.inRealm(urlWithoutQuery)) {
        if (!this.realm) {
          throw new Error('No realm is currently available');
        }
        // translate the request URL into the local base realm URL
        let url = new URL(
          request.url.slice(urlWithoutQuery.origin.length),
          this.realm.baseRealmURL
        );
        let response = await fetch(url.href, {
          method: request.method,
          headers: request.headers,
          ...(request.body ? { body: request.body } : {}),
        });
        // based on
        // https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent/respondWith#specifying_the_final_url_of_a_resource:
        //
        //     "When a service worker provides a Response to
        //     FetchEvent.respondWith(), the Response.url value will be
        //     propagated to the intercepted network request as the final
        //     resolved URL.
        //
        //     "This means, for example, if a service worker intercepts a
        //     stylesheet or worker script, then the provided Response.url will
        //     be used to resolve any relative @import or importScripts()
        //     subresource loads (bug 1222008)."
        //
        // This means that in order for our module resolution to work using the
        // canonical base realm URL we need to alter this behavior, otherwise
        // relative import references will use the wrong origin URL. According
        // to the same MDN article, a response with an empty string `url`
        // property will revert to resolving relative references using the
        // request URL. so we make a new response without a URL value to trigger
        // that behavior.
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }
      if (!this.realm) {
        console.warn(`No realm is currently available`);
      } else if (urlWithoutQuery.href.includes(this.realm.url)) {
        return await this.realm.handle(request);
      }

      console.log(
        `Service worker passing through ${request.url} for ${request.referrer}`
      );
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
