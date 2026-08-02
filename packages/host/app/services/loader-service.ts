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
  clearFetchCacheFor,
  clearInjectedScopedCSS,
  logger,
} from '@cardstack/runtime-common';

import { Loader } from '@cardstack/runtime-common/loader';

import config from '@cardstack/host/config/environment';
import { clearKnownFileMetaUrls } from '@cardstack/host/lib/known-file-meta-urls';
import { isBaseRealmModule } from '@cardstack/host/lib/realm-sandbox-import-policy';

import { authErrorEventMiddleware } from '../utils/auth-error-guard';
import { scheduleNativeTimeout } from '../utils/render-timer-stub';

import type NetworkService from './network';
import type RealmService from './realm';
import type RealmInfoService from './realm-info-service';
import type SessionService from './session';

const log = logger('loader-service');

export default class LoaderService extends Service {
  @service declare private realmInfoService: RealmInfoService;
  @service declare private realm: RealmService;
  @service declare private network: NetworkService;
  @service declare private session: SessionService;

  // Base is official code and has one module graph for the whole app/session.
  // Realm loaders delegate Base imports here so CardDef/FieldDef identity is
  // stable across cards from every realm.
  @tracked public baseLoader = this.makeBaseLoader();
  @tracked public loader = this.makeInstance();
  private realmLoaders = new Map<string, Loader>();
  private resetTime: number | undefined;

  // Modules flushed from the loader because their own source changed. A flush
  // replaces the loader with one that carries no loaded modules, so anything
  // deciding "was this module loaded?" after the flush reads a code change to a
  // live module as a net-new module. The realm index event for that same change
  // always lands after the flush that a local write or an open editor already
  // performed, so the store's rebuild decision has to survive it. The records
  // ride the loader's own lifecycle: a code-change flush adds what the
  // discarded loader held, and any other replacement drops them all — the
  // rebuild that answers the invalidation performs exactly such a replacement
  // on entry, so a record lives from the flush that wrote it to the rebuild
  // that supersedes it. A session boundary drops them too, so a write whose
  // index event never arrived (a logout, a failed indexing pass) cannot leave
  // a record for the next session, which has its own idea of what it loaded.
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
      this.baseLoader?.dispose();
      this.disposeRealmLoaders();
    });
  }

  public resetState() {
    this.clearSessionCaches();
  }

  public resetSessionBoundary(reason?: string) {
    this.resetTime = undefined;
    log.debug(`resetting loader for session boundary (${reason ?? ''})`);
    this.clearSessionCaches();
    this.replaceLoaderGraphs();
  }

  // Whether this module was among those a code change flushed out of the
  // loader. Callers pair this with `loader.isModuleLoaded` — the module counts
  // as loaded if it is loaded now, or was loaded in a loader a code change
  // discarded. Read-only: the records are dropped wholesale when the loader is
  // next replaced for any other reason, not consumed one by one.
  public wasModuleFlushedForCodeChange(moduleIdentifier: string): boolean {
    let key = this.loader?.moduleKey(moduleIdentifier);
    return key ? this.flushedForCodeChange.has(key) : false;
  }

  // The realm index event for this source generation has arrived. Targeted
  // invalidation records are per module (unlike the old whole-loader snapshot)
  // and can be consumed independently without disturbing writes still waiting
  // for their own acknowledgement.
  public acknowledgeModuleInvalidation(moduleIdentifier: string): void {
    let key = this.loader?.moduleKey(moduleIdentifier);
    if (key) {
      this.flushedForCodeChange.delete(key);
    }
  }

  // Loader topology is intentionally plural. Invalidation callers must ask
  // the service rather than inspecting the legacy host loader directly or a
  // Base/trusted-realm module can remain live after its source changes.
  public isModuleLoaded(moduleIdentifier: string): boolean {
    return this.allLoaders().some((loader) =>
      loader.isModuleLoaded(moduleIdentifier),
    );
  }

  // Evict one changed module and the already-known modules that depend on it
  // without replacing any Loader object. This is the normal source-change
  // path. In particular, user-realm changes never dispose Base or trusted
  // realm graphs, so long-running workspace/card UI keeps its class identity
  // and module cache.
  public invalidateModule(
    moduleIdentifier: string,
    options?: { clearFetchCache?: boolean; codeChange?: boolean },
  ): { invalidated: number; wasLoaded: boolean } {
    if (options?.clearFetchCache) {
      clearFetchCacheFor(moduleIdentifier);
    }

    let loaders = this.loadersForModuleInvalidation(moduleIdentifier);
    let wasLoaded = loaders.some((loader) =>
      loader.isModuleLoaded(moduleIdentifier),
    );
    let invalidated = 0;
    for (let loader of loaders) {
      invalidated += loader.invalidateModule(moduleIdentifier);
    }

    if (options?.codeChange && (wasLoaded || invalidated > 0)) {
      let key = this.loader.moduleKey(moduleIdentifier);
      if (key) {
        this.flushedForCodeChange.add(key);
      }
    }

    return { invalidated, wasLoaded };
  }

  // Called whenever the loader is actually replaced. A code-change flush makes
  // every module the outgoing loader held invisible — not just the one being
  // written — so record the whole set, keyed the way the loader keys module
  // identity, and accumulate across back-to-back flushes so an earlier write's
  // record survives until its invalidation arrives. Any other replacement
  // supersedes the records: the new loader (a rebuild's reset, a clean-loader
  // request) is the fresh baseline the next flush snapshots from.
  private recordLoaderReplacement(
    previous: Loader | undefined,
    codeChange: boolean | undefined,
  ) {
    if (codeChange) {
      for (let loader of this.allLoaders(previous)) {
        for (let key of loader.loadedModuleKeys) {
          this.flushedForCodeChange.add(key);
        }
      }
    } else {
      this.flushedForCodeChange.clear();
    }
  }

  public resetLoader(options?: {
    clearFetchCache?: boolean;
    reason?: string;
    // Set when this flush is for a module whose own source changed. The realm
    // index event for that write lands afterwards, by which point the replaced
    // loader reports nothing as loaded.
    codeChange?: boolean;
  }) {
    // clearFetchCache requests must never be debounced--the caller is
    // signalling that cached responses are stale (e.g. a module was
    // rewritten). Skipping this would cause re-indexing to use the old
    // (broken) module from the fetch cache.
    if (options?.clearFetchCache) {
      this.resetTime = Date.now();
      log.debug(`resetting loader (clearFetchCache, ${options.reason ?? ''})`);
      clearFetchCache();
      this.recordLoaderReplacement(this.loader, options.codeChange);
      this.replaceLoaderGraphs();
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
      this.recordLoaderReplacement(previous, options?.codeChange);
      this.replaceLoaderGraphs();
    }
    // A debounced call returns without replacing the loader, so nothing was
    // flushed: no records are written, and none are dropped — the live loader
    // still answers for itself.
  }

  private makeInstance() {
    return this.makeLoader(
      this.network.virtualNetwork,
      true,
      this.delegateBaseModules(),
    );
  }

  private makeBaseLoader() {
    return this.makeLoader(this.network.virtualNetwork, true);
  }

  // One ordinary (non-SES) loader per trusted realm. All cards and card types
  // from that realm share its module cache. Base imports are borrowed from the
  // app-wide Base loader instead of being evaluated again in the realm loader.
  loaderForTrustedRealm(realmURL: string | URL): Loader {
    let key = withTrailingSlash(String(realmURL));
    let existing = this.realmLoaders.get(key);
    if (existing) {
      return existing;
    }
    let loader = this.makeLoader(
      this.network.virtualNetwork,
      true,
      this.delegateBaseModules(),
    );
    this.realmLoaders.set(key, loader);
    return loader;
  }

  get trustedRealmLoaderCount(): number {
    return this.realmLoaders.size;
  }

  private delegateBaseModules() {
    return async (moduleIdentifier: string) => {
      if (
        isBaseRealmModule(moduleIdentifier) ||
        isBaseRealmModule(this.network.resolveImport(moduleIdentifier))
      ) {
        let module =
          await this.baseLoader.import<Record<string, unknown>>(
            moduleIdentifier,
          );
        return {
          module,
          consumedModules:
            this.baseLoader.getKnownConsumedModules(moduleIdentifier),
        };
      }
      return undefined;
    };
  }

  // Creates a renderer-local Loader whose network boundary is supplied by the
  // caller. The iframe renderer uses this with a MessagePort-backed fetch so
  // authored modules never need the child's Matrix session or parent secrets.
  createDetachedLoader(rootFetch: typeof globalThis.fetch) {
    let virtualNetwork = this.network.createVirtualNetwork(rootFetch);
    return this.makeLoader(virtualNetwork, false);
  }

  private makeLoader(
    virtualNetwork: NetworkService['virtualNetwork'],
    includeAuthorization: boolean,
    moduleDelegate?: (moduleIdentifier: string) => Promise<
      | {
          module: Record<string, unknown>;
          consumedModules?: Iterable<string>;
        }
      | undefined
    >,
  ) {
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

    if (includeAuthorization) {
      middlewareStack.push(authorizationMiddleware(this.realm));
      middlewareStack.push(authErrorEventMiddleware());
    }
    let fetch = fetcher(virtualNetwork.fetch, middlewareStack, virtualNetwork);
    let loader = new Loader(fetch, virtualNetwork.resolveImport, {
      // Route the loader's transient-5xx retry backoff sleep through
      // scheduleNativeTimeout so it bypasses the render-timer-stub during
      // prerender. Outside prerender this falls back to the native
      // setTimeout, so behavior is unchanged in the host runtime.
      retrySleep: (ms) =>
        new Promise<void>((resolve) =>
          scheduleNativeTimeout(() => resolve(), ms),
        ),
      virtualNetwork,
      moduleDelegate,
    });
    return loader;
  }

  private replaceLoaderGraphs() {
    let previousLoader = this.loader;
    let previousBaseLoader = this.baseLoader;
    this.disposeRealmLoaders();
    this.baseLoader = this.makeBaseLoader();
    this.loader = this.makeInstance();
    previousLoader?.dispose();
    previousBaseLoader?.dispose();
  }

  private disposeRealmLoaders() {
    for (let loader of this.realmLoaders.values()) {
      loader.dispose();
    }
    this.realmLoaders.clear();
  }

  private allLoaders(hostLoader = this.loader): Loader[] {
    return [hostLoader, this.baseLoader, ...this.realmLoaders.values()].filter(
      (loader, index, loaders): loader is Loader =>
        Boolean(loader) && loaders.indexOf(loader) === index,
    );
  }

  private loadersForModuleInvalidation(moduleIdentifier: string): Loader[] {
    let resolved = this.network.resolveImport(moduleIdentifier);
    if (isBaseRealmModule(moduleIdentifier) || isBaseRealmModule(resolved)) {
      // Trusted realm loaders borrow Base exports. Their dependency graphs can
      // therefore contain cards that must be reevaluated when Base itself
      // changes. This path is reserved for an actual Base invalidation.
      return this.allLoaders();
    }

    let loaders = [this.loader];
    for (let [realmURL, loader] of this.realmLoaders) {
      if (resolved.startsWith(realmURL)) {
        loaders.push(loader);
      }
    }
    return loaders;
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

function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

declare module '@ember/service' {
  interface Registry {
    'loader-service': LoaderService;
  }
}
