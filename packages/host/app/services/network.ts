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
    // DIAGNOSTIC (CS-11275 follow-up): temporarily disable the test-realm
    // URL mapping to determine whether it is the source of a shard-9
    // operator-mode|links regression (24 tests) that appeared on the same
    // run that closed ~66 unrelated env-mode failures. With the mapping
    // disabled the original ~80 failures concentrated in shards 4/10/11/12
    // are expected to return; if shard 9 also returns to 0 failures, the
    // mapping was the culprit. Re-enable (or replace with a narrower
    // rewrite) once the regression's mechanism is understood.
    let hardcodedTestRealmURL = new URL('https://localhost:4202/test/');
    let resolvedTestRealmURL = new URL(
      withTrailingSlash(config.resolvedTestRealmURL),
    );
    if (resolvedTestRealmURL.href !== hardcodedTestRealmURL.href) {
      // virtualNetwork.addURLMapping(hardcodedTestRealmURL, resolvedTestRealmURL);
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
