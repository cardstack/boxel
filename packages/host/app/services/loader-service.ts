import Service, { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import {
  fetcher,
  maybeHandleScopedCSSRequest,
  FetcherMiddlewareHandler,
  authorizationMiddleware,
} from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import NetworkService from '@cardstack/host/services/network';
import RealmInfoService from '@cardstack/host/services/realm-info-service';

import type RealmService from './realm';

export default class LoaderService extends Service {
  @service declare fastboot: { isFastBoot: boolean };
  @service declare realmInfoService: RealmInfoService;
  @service declare realm: RealmService;
  @service declare network: NetworkService;

  @tracked loader = this.makeInstance();

  public isIndexing = false;

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

  private makeInstance() {
    let middlewareStack: FetcherMiddlewareHandler[] = [];
    middlewareStack.push(async (req, next) => {
      if (this.isIndexing) {
        req.headers.set('X-Boxel-Building-Index', 'true');
      }
      return next(req);
    });
    middlewareStack.push(async (req, next) => {
      return (await maybeHandleScopedCSSRequest(req)) || next(req);
    });

    if (!this.fastboot.isFastBoot) {
      middlewareStack.push(authorizationMiddleware(this.realm));
    }
    let fetch = fetcher(this.network.fetch, middlewareStack);
    let loader = new Loader(fetch, this.network.resolveImport);
    return loader;
  }
}
