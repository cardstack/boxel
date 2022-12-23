import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { Loader, type ResolvedURL } from '@cardstack/runtime-common/loader';
import { baseRealm } from '@cardstack/runtime-common';

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
      return new Loader(
        (globalThis as any).resolver as {
          resolve: (
            moduleIdentifier: string | URL,
            relativeTo?: URL
          ) => ResolvedURL;
          reverseResolution: (
            moduleIdentifier: string | ResolvedURL,
            relativeTo?: URL
          ) => URL;
        }
      );
    }

    let loader = new Loader();
    loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/')
    );

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
            if (cachedJSONAPI != null) {
              return Promise.resolve(
                new Response(cachedJSONAPI, {
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
