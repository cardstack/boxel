import Service, { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';
import { tracked } from '@glimmer/tracking';

import {
  VirtualNetwork,
  baseRealm,
  fetcher,
  maybeHandleScopedCSSRequest,
  RunnerOpts,
  FetcherMiddlewareHandler,
  authorizationMiddleware,
} from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import config from '@cardstack/host/config/environment';

import { shimExternals } from '../lib/externals';

import type RealmService from './realm';

const isFastBoot = typeof (globalThis as any).FastBoot !== 'undefined';

let virtualNetworkFetchWaiter = buildWaiter('virtual-network-fetch');

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
    let fetchWithWaiter: typeof globalThis.fetch = async (...args) => {
      let token = virtualNetworkFetchWaiter.beginAsync();
      try {
        return await fetch(...args);
      } finally {
        virtualNetworkFetchWaiter.endAsync(token);
      }
    };
    return fetchWithWaiter;
  }
}

export default class LoaderService extends Service {
  @service declare fastboot: { isFastBoot: boolean };
  @service declare realm: RealmService;

  @tracked loader = this.makeInstance();

  private isIndexing = false;

  virtualNetwork = this.makeVirtualNetwork();

  reset() {
    if (this.loader) {
      this.loader = Loader.cloneLoader(this.loader);
    } else {
      this.loader = this.makeInstance();
    }
  }

  setIsIndexing(value: boolean) {
    this.isIndexing = value;
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

  private makeInstance() {
    let middlewareStack: FetcherMiddlewareHandler[] = [];
    middlewareStack.push(async (req, next) => {
      if (this.isIndexing) {
        req.headers.set('X-Boxel-Use-WIP-Index', 'true');
      }
      return next(req);
    });
    middlewareStack.push(async (req, next) => {
      return (await maybeHandleScopedCSSRequest(req)) || next(req);
    });

    if (!this.fastboot.isFastBoot) {
      middlewareStack.push(authorizationMiddleware(this.realm));
    }
    let fetch = fetcher(this.virtualNetwork.fetch, middlewareStack);
    let loader = new Loader(fetch, this.virtualNetwork.resolveImport);
    return loader;
  }
}
