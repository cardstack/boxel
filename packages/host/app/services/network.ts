import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import {
  VirtualNetwork,
  authorizationMiddleware,
  baseRealm,
  fetcher,
} from '@cardstack/runtime-common';

import config from '@cardstack/host/config/environment';

import { shimExternals } from '../lib/externals';
import { authErrorEventMiddleware } from '../utils/auth-error-guard';

import type LoaderService from './loader-service';
import type RealmService from './realm';
import type ResetService from './reset';

export default class NetworkService extends Service {
  @service declare loaderService: LoaderService;
  @service declare realm: RealmService;
  @service declare reset: ResetService;

  virtualNetwork = this.makeVirtualNetwork();

  constructor(owner: Owner) {
    super(owner);
    this.reset.register(this);
  }

  get fetch() {
    return this.virtualNetwork.fetch;
  }

  get resolveImport() {
    return this.virtualNetwork.resolveImport;
  }

  get authedFetch() {
    return fetcher(this.fetch, [
      authorizationMiddleware(this.realm),
      authErrorEventMiddleware(),
    ]);
  }

  get mount() {
    return this.virtualNetwork.mount.bind(this.virtualNetwork);
  }

  private makeVirtualNetwork() {
    let virtualNetwork = new VirtualNetwork(globalThis.fetch);
    this.installH2OriginMappings(virtualNetwork);
    let resolvedBaseRealmURL = new URL(
      withTrailingSlash(config.resolvedBaseRealmURL),
    );
    // URL mapping kept for the fake https://cardstack.com/base/ → real URL.
    // addRealmMapping registers the @cardstack/base/ scoped prefix.
    virtualNetwork.addURLMapping(new URL(baseRealm.url), resolvedBaseRealmURL);
    virtualNetwork.addRealmMapping(
      '@cardstack/base/',
      resolvedBaseRealmURL.href,
    );
    shimExternals(virtualNetwork);
    virtualNetwork.addImportMap('@cardstack/boxel-icons/', (rest) => {
      return `${config.iconsURL}/@cardstack/boxel-icons/v1/icons/${rest}.js`;
    });
    if (config.resolvedCatalogRealmURL) {
      virtualNetwork.addRealmMapping(
        '@cardstack/catalog/',
        config.resolvedCatalogRealmURL,
      );
    }
    if (config.resolvedSkillsRealmURL) {
      virtualNetwork.addRealmMapping(
        '@cardstack/skills/',
        config.resolvedSkillsRealmURL,
      );
    }
    if (config.resolvedOpenRouterRealmURL) {
      virtualNetwork.addRealmMapping(
        '@cardstack/openrouter/',
        config.resolvedOpenRouterRealmURL,
      );
    }
    return virtualNetwork;
  }

  // HTTP/2 alias re-route: when the prerender harness injects a JSON
  // list of {from, to} origin pairs as window.__realmH2OriginMappings__,
  // route realm-server fetches through the HTTPS/h2 listener(s) so
  // they multiplex over one connection per origin instead of
  // serializing through Chrome's HTTP/1.1 6-per-origin ceiling.
  // Canonical realm URLs (in card data) stay on the http origin — only
  // the wire fetch is rewritten. See the repo-root README's "HTTP/2 dev
  // access" section.
  private installH2OriginMappings(virtualNetwork: VirtualNetwork) {
    let h2MappingsRaw = (
      globalThis as unknown as { __realmH2OriginMappings__?: string }
    ).__realmH2OriginMappings__;
    if (!h2MappingsRaw) {
      return;
    }
    let pairs: Array<{ from?: string; to?: string }>;
    try {
      let parsed = JSON.parse(h2MappingsRaw);
      pairs = Array.isArray(parsed) ? parsed : [];
    } catch {
      return;
    }
    for (let { from, to } of pairs) {
      if (!from || !to) continue;
      let fromUrl: URL;
      let toUrl: URL;
      try {
        fromUrl = new URL(from);
        toUrl = new URL(to);
      } catch {
        continue;
      }
      if (fromUrl.origin === toUrl.origin) continue;
      virtualNetwork.addURLMapping(fromUrl, toUrl);
    }
  }

  resetState = () => {
    this.virtualNetwork = this.makeVirtualNetwork();
  };
}

declare module '@ember/service' {
  interface Registry {
    network: NetworkService;
  }
}

function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}
