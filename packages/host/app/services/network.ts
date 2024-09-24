import Service, { service } from '@ember/service';

import {
  VirtualNetwork,
  baseRealm,
  fetcher,
  RunnerOpts,
  authorizationMiddleware,
} from '@cardstack/runtime-common';

import config from '@cardstack/host/config/environment';

import { shimExternals } from '../lib/externals';

import type RealmService from './realm';

const isFastBoot = typeof (globalThis as any).FastBoot !== 'undefined';

function getNativeFetch(): typeof fetch {
  if (isFastBoot) {
    let optsId = (globalThis as any).runnerOptsId;
    if (optsId == null) {
      throw new Error(`Runner Options Identifier was not set`);
    }
    let getRunnerOpts = (globalThis as any).getRunnerOpts as (
      optsId: number,
    ) => RunnerOpts;
    return getRunnerOpts(optsId)._fetch;
  } else {
    return fetch;
  }
}

export default class NetworkService extends Service {
  @service declare fastboot: { isFastBoot: boolean };
  @service declare realm: RealmService;

  virtualNetwork = this.makeVirtualNetwork();

  get fetch() {
    return this.virtualNetwork.fetch;
  }

  get resolveImport() {
    return this.virtualNetwork.resolveImport;
  }

  get createEventSource() {
    return this.virtualNetwork.createEventSource.bind(this.virtualNetwork);
  }

  get authedFetch() {
    if (this.fastboot.isFastBoot) {
      return this.fetch; // "nativeFetch" already handles auth
    }
    return fetcher(this.fetch, [authorizationMiddleware(this.realm)]);
  }

  get mount() {
    return this.virtualNetwork.mount.bind(this.virtualNetwork);
  }

  private makeVirtualNetwork() {
    let virtualNetwork = new VirtualNetwork(getNativeFetch());
    if (!this.fastboot.isFastBoot) {
      virtualNetwork.addURLMapping(
        new URL(baseRealm.url),
        new URL(config.resolvedBaseRealmURL),
      );
    }
    shimExternals(virtualNetwork);
    return virtualNetwork;
  }
}
