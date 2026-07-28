import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import { isTesting } from '@embroider/macros';
import { tracked } from '@glimmer/tracking';

import type { FetcherMiddlewareHandler } from '@cardstack/runtime-common';
import {
  fetcher,
  maybeHandleScopedCSSRequest,
  authorizationMiddleware,
  clearFetchCache,
  clearInjectedScopedCSS,
  logger,
} from '@cardstack/runtime-common';

import { Loader } from '@cardstack/runtime-common/loader';

import config from '@cardstack/host/config/environment';
import { clearKnownFileMetaUrls } from '@cardstack/host/lib/known-file-meta-urls';

import { authErrorEventMiddleware } from '../utils/auth-error-guard';
import { scheduleNativeTimeout } from '../utils/render-timer-stub';

import type NetworkService from './network';
import type RealmService from './realm';
import type RealmInfoService from './realm-info-service';
import type SessionService from './session';

const log = logger('loader-service');

// A tab edits few distinct modules, so this only bounds a pathological case.
const MAX_FLUSHED_FOR_CODE_CHANGE = 100;

export default class LoaderService extends Service {
  @service declare private realmInfoService: RealmInfoService;
  @service declare private realm: RealmService;
  @service declare private network: NetworkService;
  @service declare private session: SessionService;

  @tracked public loader = this.makeInstance();
  private resetTime: number | undefined;

  // Modules flushed from the loader because their own source changed. A flush
  // replaces the loader with one that carries no loaded modules, so anything
  // deciding "was this module loaded?" after the flush reads a code change to a
  // live module as a net-new module. The realm index event for that same change
  // always lands after the flush that a local write or an open editor already
  // performed, so the store's rebuild decision has to survive it. Entries are
  // consumed by the invalidation they belong to, and dropped at a session
  // boundary — a write whose index event never arrived (a logout, a failed
  // indexing pass) must not leave a record for the next session, which has its
  // own idea of which modules it loaded.
  private flushedForCodeChange = new Set<string>();

  constructor(owner: Owner) {
    super(owner);
    this.session.register(this);
    if (isTesting()) {
      // clears the fetch cache and SSR-injected scoped styles in between tests
      this.resetState();
    }
    registerDestructor(this, () => {
      this.resetState();
      this.loader?.dispose();
    });
  }

  public resetState() {
    this.clearSessionCaches();
  }

  public resetSessionBoundary(reason?: string) {
    this.resetTime = undefined;
    log.debug(`resetting loader for session boundary (${reason ?? ''})`);
    this.clearSessionCaches();
    let previous = this.loader;
    this.loader = previous ? Loader.cloneLoader(previous) : this.makeInstance();
    previous?.dispose();
  }

  // Whether this module was flushed from the loader because its source
  // changed, consuming the record so a single flush arms a single rebuild.
  // Callers pair this with `loader.isModuleLoaded` — the module counts as
  // loaded if it is loaded now or was loaded in the loader a code change just
  // discarded.
  public takeModuleFlushedForCodeChange(moduleIdentifier: string): boolean {
    return this.flushedForCodeChange.delete(
      this.moduleFlushKey(moduleIdentifier),
    );
  }

  private noteModuleFlushedForCodeChange(moduleIdentifier: string) {
    if (this.flushedForCodeChange.size >= MAX_FLUSHED_FOR_CODE_CHANGE) {
      let oldest = this.flushedForCodeChange.values().next();
      if (!oldest.done) {
        this.flushedForCodeChange.delete(oldest.value);
      }
    }
    this.flushedForCodeChange.add(this.moduleFlushKey(moduleIdentifier));
  }

  // A module reaches the two sides of a flush record under either spelling — a
  // realm invalidation may name it scoped (`@cardstack/base/card-api`) while a
  // local write names its URL — so both sides collapse to the canonical form
  // the loader itself keys module identity under.
  private moduleFlushKey(moduleIdentifier: string): string {
    try {
      return this.network.virtualNetwork.unresolveURL(moduleIdentifier);
    } catch {
      return moduleIdentifier;
    }
  }

  public resetLoader(options?: {
    clearFetchCache?: boolean;
    reason?: string;
    // The module whose own source changed and prompted this flush. Recorded so
    // the realm index event that arrives afterwards can still tell the module
    // was loaded.
    invalidatedModule?: string;
  }) {
    if (options?.invalidatedModule) {
      this.noteModuleFlushedForCodeChange(options.invalidatedModule);
    }
    // clearFetchCache requests must never be debounced--the caller is
    // signalling that cached responses are stale (e.g. a module was
    // rewritten). Skipping this would cause re-indexing to use the old
    // (broken) module from the fetch cache.
    if (options?.clearFetchCache) {
      this.resetTime = Date.now();
      log.debug(`resetting loader (clearFetchCache, ${options.reason ?? ''})`);
      clearFetchCache();
      this.loader?.dispose();
      this.loader = this.makeInstance();
      return;
    }

    // This method is called in both the FileResource and in RealmSubscription,
    // oftentimes for the same update. It is very difficult to coordinate
    // between these two, as a CardResource is not always present (e.g. schema
    // editor). In order to prevent this from doubling up (and causing
    // unnecessary screen flashes) we add a simple leading edge debounce.
    if (this.resetTime == null || Date.now() - this.resetTime > 250) {
      this.resetTime = Date.now();
      log.debug(`resetting loader (${options?.reason ?? ''})`);
      // by default we keep the fetch cache so we can take advantage of HTTP
      // caching when rebuilding the loader state
      let previous = this.loader;
      if (previous) {
        this.loader = Loader.cloneLoader(previous);
        previous.dispose();
      } else {
        this.loader = this.makeInstance();
      }
    }
  }

  private makeInstance() {
    let middlewareStack: FetcherMiddlewareHandler[] = [];
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

    middlewareStack.push(authorizationMiddleware(this.realm));
    middlewareStack.push(authErrorEventMiddleware());
    let fetch = fetcher(
      this.network.fetch,
      middlewareStack,
      this.network.virtualNetwork,
    );
    let loader = new Loader(fetch, this.network.resolveImport, {
      // Route the loader's transient-5xx retry backoff sleep through
      // scheduleNativeTimeout so it bypasses the render-timer-stub during
      // prerender. Outside prerender this falls back to the native
      // setTimeout, so behavior is unchanged in the host runtime.
      retrySleep: (ms) =>
        new Promise<void>((resolve) =>
          scheduleNativeTimeout(() => resolve(), ms),
        ),
      virtualNetwork: this.network.virtualNetwork,
    });
    return loader;
  }

  private clearSessionCaches() {
    // This clears cached module fetches and scoped styles at session/test
    // boundaries so private realm assets do not leak across owners.
    this.flushedForCodeChange.clear();
    clearFetchCache();
    clearInjectedScopedCSS();
    clearKnownFileMetaUrls();
  }
}

declare module '@ember/service' {
  interface Registry {
    'loader-service': LoaderService;
  }
}
