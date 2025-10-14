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
  logger,
} from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import config from '@cardstack/host/config/environment';

import type NetworkService from './network';
import type RealmService from './realm';
import type RealmInfoService from './realm-info-service';
import type ResetService from './reset';

const log = logger('loader-service');

export default class LoaderService extends Service {
  @service declare private fastboot: { isFastBoot: boolean };
  @service declare private realmInfoService: RealmInfoService;
  @service declare private realm: RealmService;
  @service declare private network: NetworkService;
  @service declare private reset: ResetService;

  @tracked public loader = this.makeInstance();
  private resetTime: number | undefined;

  public isIndexing = false;

  constructor(owner: Owner) {
    super(owner);
    this.reset.register(this);
    // this clears the fetch cache in between tests
    this.resetState();
    registerDestructor(this, () => this.resetState());
  }

  public resetState() {
    // this clears the fetch cache in between logins, the idea being that we
    // don't want to leak modules from private realms between sessions.
    clearFetchCache();
  }

  public resetLoader(options?: { clearFetchCache?: boolean; reason?: string }) {
    // This method is called in both the FileResource and in RealmSubscription,
    // oftentimes for the same update. It is very difficult to coordinate
    // between these two, as a CardResource is not always present (e.g. schema
    // editor). In order to prevent this from doubling up (and causing
    // unnecessary screen flashes) we add a simple leading edge debounce.
    if (this.resetTime == null || Date.now() - this.resetTime > 250) {
      this.resetTime = Date.now();
      let reasonSuffix = options?.reason ? ` (${options.reason})` : '';
      let clearFlag = options?.clearFetchCache ? ' [clearFetchCache]' : '';
      log.debug(`resetting loader${reasonSuffix}${clearFlag}`);
      if (options?.clearFetchCache) {
        clearFetchCache();
        this.loader = this.makeInstance();
        return;
      }
      // by default we keep the fetch cache so we can take advantage of HTTP
      // caching when rebuilding the loader state
      if (this.loader) {
        this.loader = Loader.cloneLoader(this.loader);
      } else {
        this.loader = this.makeInstance();
      }
    } else if (options?.reason) {
      log.debug(
        `skipping loader reset due to debounce window (${options.reason})`,
      );
    }
  }

  public setIsIndexing(value: boolean) {
    this.isIndexing = value;
  }

  private makeInstance() {
    let middlewareStack: FetcherMiddlewareHandler[] = [];
    middlewareStack.push(async (req, next) => {
      if (this.isIndexing) {
        // externally hosted sites may object to our custom header--like
        // esm.run. Their CORS rules reject this header.
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

declare module '@ember/service' {
  interface Registry {
    'loader-service': LoaderService;
  }
}
