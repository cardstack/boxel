import { registerDestructor } from '@ember/destroyable';
import Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import {
  fetcher,
  maybeHandleScopedCSSRequest,
  FetcherMiddlewareHandler,
  authorizationMiddleware,
  clearFetchCache,
} from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import config from '@cardstack/host/config/environment';
import NetworkService from '@cardstack/host/services/network';
import RealmInfoService from '@cardstack/host/services/realm-info-service';
import ResetService from '@cardstack/host/services/reset';

import type RealmService from './realm';

export default class LoaderService extends Service {
  @service declare fastboot: { isFastBoot: boolean };
  @service declare realmInfoService: RealmInfoService;
  @service declare realm: RealmService;
  @service declare network: NetworkService;
  @service declare private reset: ResetService;

  @tracked loader = this.makeInstance();
  private resetTime: number | undefined;

  public isIndexing = false;

  constructor(owner: Owner) {
    super(owner);
    this.reset.register(this);
    this.resetState();
    registerDestructor(this, () => this.resetState());
  }

  resetState() {
    clearFetchCache();
  }

  resetLoader() {
    // This method is called in both the FileResource and in RealmSubscription,
    // oftentimes for the same update. It is very difficult to coordinate
    // between these two, as a CardResource is not always present (e.g. schema
    // editor). In order to prevent this from doubling up (and causing
    // unnecessary screen flashes) we add a simple leading edge debounce.
    if (this.resetTime == null || Date.now() - this.resetTime > 250) {
      this.resetTime = Date.now();
      if (this.loader) {
        this.loader = Loader.cloneLoader(this.loader);
      } else {
        this.loader = this.makeInstance();
      }
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
    middlewareStack.push(async (req, next) => {
      let response = await next(req);
      if (
        !response.ok &&
        req.url.startsWith(
          `${config.iconsURL}/@cardstack/boxel-icons/v1/icons/`,
        )
      ) {
        req = new Request(
          `${config.iconsURL}/@cardstack/boxel-icons/v1/icons/error-404.js`,
          req,
        );
        response = await next(req);
      }
      return response;
    });

    if (!this.fastboot.isFastBoot) {
      middlewareStack.push(authorizationMiddleware(this.realm));
    }
    let fetch = fetcher(this.network.fetch, middlewareStack);
    let loader = new Loader(fetch, this.network.resolveImport);
    return loader;
  }
}
