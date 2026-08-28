import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import { isTesting } from '@embroider/macros';
import { tracked } from '@glimmer/tracking';

import type { FetcherMiddlewareHandler } from '@cardstack/runtime-common';
import {
  canonicalModuleKey,
  fetcher,
  maybeHandleScopedCSSRequest,
  authorizationMiddleware,
  clearFetchCache,
  clearInjectedScopedCSS,
  logger,
} from '@cardstack/runtime-common';

import { Loader } from '@cardstack/runtime-common/loader';

import config from '@cardstack/host/config/environment';
import { installBoxelLoaderCompatibilityModules } from '@cardstack/host/lib/boxel-loader-compatibility';
import { clearKnownFileMetaUrls } from '@cardstack/host/lib/known-file-meta-urls';

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

  @tracked public loader = this.makeInstance();
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
  private executableModuleConsumers = new Map<string, number>();
  private deniedHostModuleEvaluations = new Set<string>();

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

  // Whether this module was among those a code change flushed out of the
  // loader. Callers pair this with `loader.isModuleLoaded` — the module counts
  // as loaded if it is loaded now, or was loaded in a loader a code change
  // discarded. Read-only: the records are dropped wholesale when the loader is
  // next replaced for any other reason, not consumed one by one.
  public wasModuleFlushedForCodeChange(moduleIdentifier: string): boolean {
    let key = this.loader?.moduleKey(moduleIdentifier);
    return key ? this.flushedForCodeChange.has(key) : false;
  }

  /**
   * Retain the fact that an RP surface currently executes this module.
   * Loader.isModuleLoaded() is an implementation cache observation, not a
   * presentation-lifecycle fact: Direct RP can render a constructor already
   * held by the Store, and unrelated loader replacements can empty that cache
   * before the realm's index acknowledgement arrives. The Store uses this
   * reference-counted interest to decide whether an executable invalidation
   * must rebuild the live graph.
   */
  public retainExecutableModule(moduleIdentifier: string): () => void {
    let key = this.loader.moduleKey(moduleIdentifier) ?? moduleIdentifier;
    this.executableModuleConsumers.set(
      key,
      (this.executableModuleConsumers.get(key) ?? 0) + 1,
    );
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      let count = this.executableModuleConsumers.get(key) ?? 0;
      if (count <= 1) {
        this.executableModuleConsumers.delete(key);
      } else {
        this.executableModuleConsumers.set(key, count - 1);
      }
    };
  }

  public isExecutableModuleInUse(moduleIdentifier: string): boolean {
    let key = this.loader.moduleKey(moduleIdentifier) ?? moduleIdentifier;
    return (this.executableModuleConsumers.get(key) ?? 0) > 0;
  }

  /**
   * Permanently deny Host evaluation of these modules for the current
   * authenticated session. The execution admission boundary calls this
   * before handing an authored document to an isolated runtime. Refusing a
   * module that is already present is intentional: classification happened
   * too late to make a code-containment claim for that document.
   */
  public denyHostModuleEvaluation(moduleIdentifiers: Iterable<string>): void {
    let admitted: { identifier: string; key: string }[] = [];
    for (let identifier of moduleIdentifiers) {
      let key = this.moduleEvaluationKey(identifier);
      if (this.loader.isModuleLoaded(identifier)) {
        throw new Error(
          `Cannot admit ${identifier} to Sandbox after the Host Loader has already loaded it`,
        );
      }
      admitted.push({ identifier, key });
    }
    for (let { key } of admitted) {
      this.deniedHostModuleEvaluations.add(key);
    }
  }

  public isHostModuleEvaluationDenied(moduleIdentifier: string): boolean {
    return this.deniedHostModuleEvaluations.has(
      this.moduleEvaluationKey(moduleIdentifier),
    );
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
      for (let key of previous?.loadedModuleKeys ?? []) {
        this.flushedForCodeChange.add(key);
      }
    } else {
      this.flushedForCodeChange.clear();
    }
  }

  public resetLoader(options?: {
    clearFetchCache?: boolean;
    /**
     * Replace the loader even when another reset happened inside the ordinary
     * dedupe window. Use this only when the caller is advancing an executable
     * source generation; suppressing that reset would leave stale code live.
     */
    force?: boolean;
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
    if (options?.clearFetchCache || options?.force) {
      this.resetTime = Date.now();
      log.debug(
        `resetting loader (${options.clearFetchCache ? 'clearFetchCache' : 'forced'}, ${options.reason ?? ''})`,
      );
      if (options.clearFetchCache) {
        clearFetchCache();
      }
      let previous = this.loader;
      this.recordLoaderReplacement(previous, options.codeChange);
      this.loader = options.clearFetchCache
        ? this.makeInstance()
        : previous
          ? Loader.cloneLoader(previous)
          : this.makeInstance();
      previous?.dispose();
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
      if (previous) {
        this.loader = Loader.cloneLoader(previous);
        previous.dispose();
      } else {
        this.loader = this.makeInstance();
      }
    }
    // A debounced call returns without replacing the loader, so nothing was
    // flushed: no records are written, and none are dropped — the live loader
    // still answers for itself.
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
      assertModuleEvaluationAllowed: (moduleIdentifier) => {
        if (this.isHostModuleEvaluationDenied(moduleIdentifier)) {
          throw new Error(
            `Host Loader refused Sandbox-owned module ${moduleIdentifier}`,
          );
        }
      },
    });
    installBoxelLoaderCompatibilityModules(loader);
    return loader;
  }

  private clearSessionCaches() {
    // This clears cached module fetches and scoped styles at session/test
    // boundaries so private realm assets do not leak across owners.
    this.flushedForCodeChange.clear();
    this.deniedHostModuleEvaluations.clear();
    clearFetchCache();
    clearInjectedScopedCSS();
    clearKnownFileMetaUrls();
  }

  private moduleEvaluationKey(moduleIdentifier: string): string {
    try {
      return canonicalModuleKey(moduleIdentifier, this.network.virtualNetwork);
    } catch {
      return moduleIdentifier;
    }
  }
}

declare module '@ember/service' {
  interface Registry {
    'loader-service': LoaderService;
  }
}
