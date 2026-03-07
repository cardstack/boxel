import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import {
  VirtualNetwork,
  authorizationMiddleware,
  baseRealm,
  registerCardReferencePrefix,
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

  get resolveForFetch() {
    return this.virtualNetwork.resolveForFetch;
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
    let resolvedBaseRealmURL = new URL(
      withTrailingSlash(config.resolvedBaseRealmURL),
    );
    virtualNetwork.addURLMapping(new URL(baseRealm.url), resolvedBaseRealmURL);
    shimExternals(virtualNetwork);
    virtualNetwork.addImportMap('@cardstack/boxel-icons/', (rest) => {
      return `${config.iconsURL}/@cardstack/boxel-icons/v1/icons/${rest}.js`;
    });
    if (config.resolvedCatalogRealmURL) {
      let catalogURL = withTrailingSlash(config.resolvedCatalogRealmURL);
      registerCardReferencePrefix('@cardstack/catalog/', catalogURL);
      virtualNetwork.addRealmPrefix('@cardstack/catalog/', catalogURL);
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
