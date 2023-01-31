import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { Loader } from '@cardstack/runtime-common/loader';
import { baseRealm, createResponse } from '@cardstack/runtime-common';

export default class LoaderService extends Service {
  @service declare fastboot: { isFastBoot: boolean };
  @tracked loader = this.makeInstance();
  private staticResponses = new Map<string, string>();

  reset() {
    this.loader = Loader.cloneLoader(this.loader);
  }

  setStaticResponses(staticResponses: Map<string, string>) {
    this.staticResponses = staticResponses;
  }

  private makeInstance() {
    if (this.fastboot.isFastBoot) {
      return this.makeProxiedLoader(Loader.createLoaderFromGlobal());
    }

    let loader = Loader.createLoaderFromGlobal();
    // TODO we need to think about the best way to do this. Basically we need to
    // provide the service worker the same kind of resolution mapping config
    // that we provide the realm server running in node. it's probably not a
    // good idea to hard code this to the local dev setup. This will be a
    // requirement if we want to have a hosted env be able to run in a "creator"
    // mode where the user can build cards from their local system.
    loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/')
    );
    return this.makeProxiedLoader(loader);
  }

  // TODO no more need to proxy the loader--this was a side effect of not using
  // render driven indexing
  private makeProxiedLoader(loader: Loader) {
    return new Proxy(loader, {
      get: (target, property, received) => {
        let maybeFetch = Reflect.get(target, property, received);
        if (property === 'fetch') {
          return (
            urlOrRequest: string | URL | Request,
            init?: RequestInit
          ): Promise<Response> => {
            let requestURL =
              urlOrRequest instanceof Request
                ? urlOrRequest.url
                : typeof urlOrRequest === 'string'
                ? urlOrRequest
                : urlOrRequest.href;
            let cachedJSONAPI = this.staticResponses.get(requestURL);
            if (
              cachedJSONAPI != null &&
              (!init || !init.method || init.method.toUpperCase() === 'GET')
            ) {
              return Promise.resolve(
                createResponse(cachedJSONAPI, {
                  status: 200,
                  headers: {
                    'content-type': 'application/vnd.api+json',
                  },
                })
              );
            }
            return maybeFetch.bind(target)(urlOrRequest, init);
          };
        }
        return maybeFetch;
      },
    });
  }
}
