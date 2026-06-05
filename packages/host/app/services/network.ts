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
    return fetcher(
      this.fetch,
      [authorizationMiddleware(this.realm), authErrorEventMiddleware()],
      this.virtualNetwork,
    );
  }

  get mount() {
    return this.virtualNetwork.mount.bind(this.virtualNetwork);
  }

  private makeVirtualNetwork() {
    let virtualNetwork = new VirtualNetwork(globalThis.fetch);
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
    // Test fixtures and helpers hardcode the standard-mode live test realm
    // URL (https://localhost:4202/test/), but in environment mode the live
    // test realm is served at a per-environment Traefik hostname. Rewrite
    // the hardcoded URL to whatever the running test realm-server is
    // actually serving so the same test bundle works in both modes. No-op
    // when the URLs already match (standard mode, production).
    let hardcodedTestRealmURL = new URL('https://localhost:4202/test/');
    let resolvedTestRealmURL = new URL(
      withTrailingSlash(config.resolvedTestRealmURL),
    );
    if (resolvedTestRealmURL.href !== hardcodedTestRealmURL.href) {
      virtualNetwork.addURLMapping(hardcodedTestRealmURL, resolvedTestRealmURL);
    }
    return virtualNetwork;
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
