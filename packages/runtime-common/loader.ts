import { transpileAmd } from './amd-transpile';
import { Deferred } from './deferred';
import { cachedFetch, type MaybeCachedResponse } from './cached-fetch';
import { executableExtensions, logger } from './index';

import { CardError, iconNotFoundMessage } from './error';
import flatMap from 'lodash/flatMap';
import {
  trackRuntimeModuleDependency,
  type RuntimeDependencyTrackingContext,
} from './dependency-tracker';
import type { VirtualNetwork } from './virtual-network';

type FetchingModule = {
  state: 'fetching';
  deferred: Deferred<void>;
  // CS-10872: retain the full requested module URL (with extension)
  // since `setModule` stores modules under a trimmed identifier for
  // cache purposes. The diagnostic getter returns this string instead
  // of the trimmed map key so timeout diagnostics point at a real,
  // resolvable URL.
  originalURL: string;
};

type RegisteredModule = {
  state: 'registered';
  dependencyList: UnregisteredDep[];
  implementation: Function;
};

type RegisteredCompletingDepsModule = {
  state: 'registered-completing-deps';
  dependencies: EvaluatableDep[];
  implementation: Function;
};

type RegisteredWithDepsModule = {
  state: 'registered-with-deps';
  dependencies: EvaluatableDep[];
  implementation: Function;
};

type PreparingModule = {
  // this state represents the *synchronous* window of time where this
  // module's dependencies are moving from registered to preparing to
  // evaluated. Because this is synchronous, you can rely on the fact that
  // encountering a load for a module that is in "preparing" means you have a
  // cycle.
  state: 'preparing';
  implementation: Function;
  moduleInstance: object;
  consumedModules: Set<string>;
};

type EvaluatedModule = {
  state: 'evaluated';
  moduleInstance: object;
  consumedModules: Set<string>;
};

type BrokenModule = {
  state: 'broken';
  exception: any;
  consumedModules: Set<string>;
};

type Module =
  | FetchingModule
  | RegisteredModule
  | RegisteredCompletingDepsModule
  | RegisteredWithDepsModule
  | PreparingModule
  | EvaluatedModule
  | BrokenModule;

type EvaluatableModule =
  | RegisteredCompletingDepsModule
  | RegisteredWithDepsModule
  | PreparingModule
  | EvaluatedModule
  | BrokenModule;

type UnregisteredDep =
  | { type: 'dep'; moduleURL: URL }
  | { type: '__import_meta__' }
  | { type: 'exports' };

type EvaluatableDep =
  | {
      type: 'dep';
      moduleURL: URL;
    }
  | {
      type: 'completing-dep';
      moduleURL: URL;
    }
  | { type: '__import_meta__' }
  | { type: 'exports' };

export type RequestHandler = (req: Request) => Promise<Response | null>;

type Fetch = typeof fetch;

// Transient upstream statuses that we briefly retry on module-source fetches
// (e.g. nginx returning 502/503/504 while the single-writer realm server is
// momentarily stalled under reindex load — see CS-10820). Kept private so
// the retry policy can't be mutated at runtime; consumers test membership
// via `isRetryableStatus`.
const RETRYABLE_STATUS_CODES: ReadonlySet<number> = new Set([502, 503, 504]);

export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status);
}

// Backoff ladder (ms). The first attempt has no delay; subsequent retry
// attempts wait DEFAULT_TRANSIENT_RETRY_DELAYS_MS[i - 1] before firing. The
// array length determines the total attempt budget (initial + retries).
// Worst-case added latency on persistent 5xx: ~1.3s (100 + 300 + 900 ms).
export const DEFAULT_TRANSIENT_RETRY_DELAYS_MS: readonly number[] = [
  100, 300, 900,
] as const;

// Retry a fetch-like call on transient upstream 5xx responses with a short
// backoff. Non-retryable statuses (including 500) and 2xx responses surface
// immediately; only the status codes in RETRYABLE_STATUS_CODES trigger a
// retry. Note on thrown errors: Loader's own `_fetch` converts network
// failures into a synthetic 500 Response (see _fetch below), so in practice
// network failures arrive here as non-retryable 500 responses rather than
// as thrown exceptions. A thrown error from `doFetch` still propagates
// without retry, but that path is only hit by alternate callers.
//
// The `dispose` option lets the caller release resources (e.g. cancel an
// unread Response body) on each response that's about to be discarded due
// to retry. Without it, `fetch` implementations that require body disposal
// for connection reuse (notably Node's undici) can accumulate unread bodies
// under repeated transient failures and tie up sockets.
export async function fetchWithTransientRetry<R extends { status: number }>(
  doFetch: () => Promise<R>,
  options: {
    delaysMs?: readonly number[];
    sleep?: (ms: number) => Promise<void>;
    onRetry?: (info: {
      attempt: number;
      maxAttempts: number;
      status: number;
      delayMs: number;
    }) => void;
    dispose?: (response: R) => void | Promise<void>;
  } = {},
): Promise<R> {
  let delaysMs = options.delaysMs ?? DEFAULT_TRANSIENT_RETRY_DELAYS_MS;
  let sleep = options.sleep ?? defaultSleep;
  let maxAttempts = delaysMs.length + 1;
  let response: R | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    response = await doFetch();
    if (!isRetryableStatus(response.status) || attempt === maxAttempts) {
      return response;
    }
    let delayMs = delaysMs[attempt - 1];
    options.onRetry?.({
      attempt,
      maxAttempts,
      status: response.status,
      delayMs,
    });
    if (options.dispose) {
      try {
        await options.dispose(response);
      } catch {
        // Best-effort: never let a disposal failure mask the underlying
        // transient error we were about to retry past.
      }
    }
    await sleep(delayMs);
  }
  // Unreachable: the loop either returns inside on a non-retryable status or
  // on the final attempt. Present to satisfy TS control-flow analysis.
  return response!;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let nonce = 0;
export class Loader {
  nonce = nonce++; // the nonce is a useful debugging tool that let's us compare loaders
  private log = logger('loader');
  private modules = new Map<string, Module>();

  private moduleShims = new Map<string, Record<string, any>>();
  private moduleCanonicalURLs = new Map<string, string>();
  // Cache the flattened dependency sets for evaluated modules. Once a module is
  // evaluated its consumedModules never change, so the result of
  // collectKnownModuleDependencies is stable and can be reused across repeated
  // loader.import() calls (e.g. when deserializing 22 cards of the same type).
  private knownDepsCache = new Map<string, Set<string>>();
  private identities = new WeakMap<
    Function,
    { module: string; name: string }
  >();
  private static loaders = new WeakMap<Function, Loader>();

  private fetchImplementation: Fetch;
  private resolveImport: (moduleIdentifier: string) => string;
  private virtualNetwork: VirtualNetwork | undefined;
  // When the host runs inside a prerender, `setTimeout` is suppressed by
  // the render-timer-stub so the default sleep used by
  // `fetchWithTransientRetry` would never resolve and a transient 5xx on
  // a dep fetch would hang the render until the prerender timeout. The
  // host injects a sleep that goes through the native (unblocked)
  // setTimeout so the retry actually fires.
  private retrySleep: ((ms: number) => Promise<void>) | undefined;

  constructor(
    fetch: Fetch,
    resolveImport?: (moduleIdentifier: string) => string,
    options?: {
      retrySleep?: (ms: number) => Promise<void>;
      virtualNetwork?: VirtualNetwork;
    },
  ) {
    this.fetchImplementation = fetch;
    this.resolveImport =
      resolveImport ?? ((moduleIdentifier) => moduleIdentifier);
    this.retrySleep = options?.retrySleep;
    this.virtualNetwork = options?.virtualNetwork;
  }

  getVirtualNetwork(): VirtualNetwork | undefined {
    return this.virtualNetwork;
  }

  static cloneLoader(loader: Loader): Loader {
    let clone = new Loader(loader.fetchImplementation, loader.resolveImport, {
      retrySleep: loader.retrySleep,
      virtualNetwork: loader.virtualNetwork,
    });
    for (let [moduleIdentifier, module] of loader.moduleShims) {
      clone.shimModule(moduleIdentifier, module);
    }
    return clone;
  }

  get fetch() {
    return this.fetchImplementation;
  }

  // CS-10872: diagnostic accessor — module URLs currently in the
  // 'fetching' state. Used by the prerender server to populate a
  // Render-timeout error document with "what the loader was waiting
  // on". Returns [] when the loader is quiescent. Intentionally read-
  // only; do not use for control flow.
  //
  // Note: we iterate the modules map but return each FetchingModule's
  // stored `originalURL`, not the trimmed map key. The cache keys have
  // executable extensions stripped (see `trimModuleIdentifier`), so a
  // naive key read would conflate `.gts` / `.ts` / `.js` siblings and
  // surface unresolvable identifiers in the timeout diagnostics.
  get inFlightModuleImports(): string[] {
    let urls: string[] = [];
    for (let mod of this.modules.values()) {
      if (mod.state === 'fetching') {
        urls.push(mod.originalURL);
      }
    }
    return urls;
  }

  // CS-10872: module-evaluation instrumentation. Each `evaluate()`
  // call synchronously runs `module.implementation(...)`, which is
  // where Glimmer template compilation and other sync work lives.
  // When the main thread is blocked inside that call nothing async
  // can run — so we set a breadcrumb *before* the call (so any
  // post-stall diagnostic read names the stuck module) and keep a
  // bounded top-N history of the worst evaluations (so fan-out of
  // many cheap-but-not-free compiles becomes visible as a sum).
  #currentlyEvaluatingModule: string | null = null;
  #moduleEvaluationHistory: Array<{ url: string; ms: number }> = [];
  static #MAX_MODULE_EVAL_HISTORY = 30;
  get currentlyEvaluatingModule(): string | null {
    return this.#currentlyEvaluatingModule;
  }
  get recentModuleEvaluations(): Array<{ url: string; ms: number }> {
    return [...this.#moduleEvaluationHistory];
  }
  private recordModuleEvaluation(url: string, ms: number): void {
    let hist = this.#moduleEvaluationHistory;
    hist.push({ url, ms });
    // Keep only the slowest N. Sort desc by ms and truncate.
    if (hist.length > Loader.#MAX_MODULE_EVAL_HISTORY) {
      hist.sort((a, b) => b.ms - a.ms);
      hist.length = Loader.#MAX_MODULE_EVAL_HISTORY;
    }
  }

  shimModule(moduleIdentifier: string, module: Record<string, any>) {
    moduleIdentifier = this.resolveImport(moduleIdentifier);
    this.captureIdentitiesOfModuleExports(module, moduleIdentifier);
    this.setCanonicalModuleURL(moduleIdentifier, moduleIdentifier);

    this.moduleShims.set(moduleIdentifier, module);

    this.setModule(moduleIdentifier, {
      state: 'evaluated',
      moduleInstance: module,
      consumedModules: new Set(),
    });
  }

  async getConsumedModules(
    moduleIdentifier: string,
    consumed: string[] = [],
    initialIdentifier = moduleIdentifier,
  ): Promise<string[]> {
    // Normalize to resolved URL href so that prefix-form identifiers
    // (e.g. @cardstack/catalog/...) and their resolved URL equivalents
    // are treated as the same module for cycle detection and self-exclusion.
    let resolvedHref = this.virtualNetwork
      ? this.virtualNetwork.toURL(moduleIdentifier).href
      : new URL(moduleIdentifier).href;
    let resolvedInitial = this.virtualNetwork
      ? this.virtualNetwork.toURL(initialIdentifier).href
      : new URL(initialIdentifier).href;

    if (consumed.includes(resolvedHref)) {
      return [];
    }
    // you can't consume yourself
    if (resolvedHref !== resolvedInitial) {
      consumed.push(resolvedHref);
    }

    let module = this.getModule(resolvedHref);

    if (!module || module.state === 'fetching') {
      // we haven't yet tried importing the module or we are still in the process of importing the module
      try {
        await this.import<Record<string, any>>(moduleIdentifier);
      } catch (err: any) {
        this.log.warn(
          `encountered an error trying to load the module ${moduleIdentifier}. The consumedModule result includes all the known consumed modules including the module that caused the error: ${err.message}`,
        );
      }
    }
    if (module?.state === 'evaluated' || module?.state === 'broken') {
      for (let consumedModule of module?.consumedModules ?? []) {
        await this.getConsumedModules(
          consumedModule,
          consumed,
          initialIdentifier,
        );
      }
      return [...new Set(consumed)]; // Get rid of duplicates
    }
    return [];
  }

  static identify(
    value: unknown,
  ): { module: string; name: string } | undefined {
    if (typeof value !== 'function') {
      return undefined;
    }
    let loader = Loader.loaders.get(value);
    if (loader) {
      return loader.identify(value);
    } else {
      return undefined;
    }
  }

  identify(value: unknown): { module: string; name: string } | undefined {
    if (typeof value === 'function') {
      return this.identities.get(value);
    } else {
      return undefined;
    }
  }

  static getLoaderFor(value: unknown): Loader | undefined {
    if (typeof value === 'function') {
      return Loader.loaders.get(value);
    }
    return undefined;
  }

  async import<T extends object>(
    moduleIdentifier: string,
    dependencyTrackingContext?: RuntimeDependencyTrackingContext,
  ): Promise<T> {
    moduleIdentifier = this.resolveImport(moduleIdentifier);
    let resolvedModule = new URL(moduleIdentifier);
    let resolvedModuleIdentifier = resolvedModule.href;
    if (!this.moduleShims.has(resolvedModuleIdentifier)) {
      trackRuntimeModuleDependency(
        resolvedModuleIdentifier,
        dependencyTrackingContext,
      );
    }

    await this.advanceToState(resolvedModule, 'evaluated');
    this.trackKnownModuleDependencies(
      resolvedModuleIdentifier,
      dependencyTrackingContext,
    );
    let module = this.getModule(resolvedModuleIdentifier);
    switch (module?.state) {
      case 'evaluated':
      case 'preparing':
        return module.moduleInstance as T;
      case 'broken':
        throw module.exception;
      default:
        throw new Error(
          `bug: advanceToState('${moduleIdentifier}', 'evaluated') resulted in state ${module?.state}`,
        );
    }
  }

  isModuleLoaded(moduleIdentifier: string): boolean {
    try {
      moduleIdentifier = this.resolveImport(moduleIdentifier);
      let resolvedModuleIdentifier = new URL(moduleIdentifier).href;
      return this.getModule(resolvedModuleIdentifier) !== undefined;
    } catch (e) {
      if (e instanceof TypeError) {
        return false;
      }
      throw e;
    }
  }

  getKnownConsumedModules(moduleIdentifier: string): string[] {
    let resolvedModuleIdentifier = this.resolveImport(moduleIdentifier);
    let knownDependencies = this.collectKnownModuleDependencies(
      resolvedModuleIdentifier,
    );
    // Filter rather than delete to avoid mutating the cached Set
    return [...knownDependencies].filter(
      (dep) => dep !== resolvedModuleIdentifier,
    );
  }

  private trackKnownModuleDependencies(
    rootModuleIdentifier: string,
    dependencyTrackingContext?: RuntimeDependencyTrackingContext,
  ): void {
    for (let moduleIdentifier of this.collectKnownModuleDependencies(
      rootModuleIdentifier,
    )) {
      if (!this.moduleShims.has(moduleIdentifier)) {
        trackRuntimeModuleDependency(
          moduleIdentifier,
          dependencyTrackingContext,
        );
      }
    }
  }

  private collectKnownModuleDependencies(
    rootModuleIdentifier: string,
  ): Set<string> {
    let cached = this.knownDepsCache.get(rootModuleIdentifier);
    if (cached) {
      return cached;
    }

    let pending = [rootModuleIdentifier];
    let visited = new Set<string>();

    while (pending.length > 0) {
      let moduleIdentifier = pending.pop()!;
      if (visited.has(moduleIdentifier)) {
        continue;
      }
      visited.add(moduleIdentifier);

      // If we already computed the full dep set for this subtree, merge it
      // in and skip traversing its children.
      let cachedSubtree = this.knownDepsCache.get(moduleIdentifier);
      if (cachedSubtree) {
        for (let dep of cachedSubtree) {
          visited.add(dep);
        }
        continue;
      }

      let module = this.getModule(moduleIdentifier);
      if (!module) {
        continue;
      }

      switch (module.state) {
        case 'evaluated':
        case 'preparing':
        case 'broken':
          for (let consumed of module.consumedModules) {
            pending.push(consumed);
          }
          break;
        case 'registered':
          for (let entry of module.dependencyList) {
            if (entry.type === 'dep') {
              pending.push(entry.moduleURL.href);
            }
          }
          break;
        case 'registered-completing-deps':
        case 'registered-with-deps':
          for (let entry of module.dependencies) {
            if (entry.type === 'dep' || entry.type === 'completing-dep') {
              pending.push(entry.moduleURL.href);
            }
          }
          break;
        case 'fetching':
          break;
        default:
          throw assertNever(module);
      }
    }

    this.knownDepsCache.set(rootModuleIdentifier, visited);
    return visited;
  }

  private async advanceToState(
    resolvedURL: URL,
    targetState:
      | 'registered-completing-deps'
      | 'registered-with-deps'
      | 'evaluated',
    stack: {
      'registered-completing-deps': string[];
      'registered-with-deps': string[];
    } = {
      'registered-completing-deps': [],
      'registered-with-deps': [],
    },
  ): Promise<void> {
    for (;;) {
      let module = this.getModule(resolvedURL.href);
      this.log.trace(
        `advance ${resolvedURL.href} to '${targetState}' current state is '${module?.state}'`,
      );

      outer_switch: switch (module?.state) {
        case undefined:
          await this.fetchModule(resolvedURL);
          break;
        case 'fetching':
          await module.deferred.promise;
          break;
        case 'registered': {
          let maybeReadyDeps: EvaluatableDep[] = [];
          for (let entry of module.dependencyList) {
            if (entry.type === '__import_meta__' || entry.type === 'exports') {
              maybeReadyDeps.push(entry);
              continue;
            }
            let depModule = this.getModule(entry.moduleURL.href);
            if (!isEvaluatable(depModule)) {
              // we always only await the first dep that actually needs work and
              // then break back to the top-level state machine, so that we'll
              // be working from the latest state.
              if (
                !stack['registered-completing-deps'].includes(
                  entry.moduleURL.href,
                )
              ) {
                await this.advanceToState(
                  entry.moduleURL,
                  'registered-completing-deps',
                  {
                    ...stack,
                    ...{
                      'registered-completing-deps': [
                        ...stack['registered-completing-deps'],
                        resolvedURL.href,
                      ],
                    },
                  },
                );
                break outer_switch;
              } else if (isRegistered(depModule)) {
                maybeReadyDeps.push({
                  type: 'completing-dep',
                  moduleURL: entry.moduleURL,
                });
              }
            } else if (depModule.state === 'registered-completing-deps') {
              maybeReadyDeps.push({
                type: 'completing-dep',
                moduleURL: entry.moduleURL,
              });
            } else {
              maybeReadyDeps.push({
                type: 'dep',
                moduleURL: entry.moduleURL,
              });
            }
          }
          this.setModule(resolvedURL.href, {
            state: 'registered-completing-deps',
            implementation: module.implementation,
            dependencies: maybeReadyDeps,
          });
          break;
        }

        case 'registered-completing-deps': {
          if (targetState === 'registered-completing-deps') {
            return;
          }
          // at this point everything is ready, we just need to transition the
          // module states
          let readyDeps: EvaluatableDep[] = [];
          for (let entry of module.dependencies) {
            if (entry.type === '__import_meta__' || entry.type === 'exports') {
              readyDeps.push(entry);
              continue;
            }
            let depModule = this.getModule(entry.moduleURL.href);
            if (entry.type === 'dep') {
              readyDeps.push({
                type: 'dep',
                moduleURL: entry.moduleURL,
              });
              continue;
            }
            switch (depModule?.state) {
              case undefined:
              case 'fetching':
              case 'registered':
                throw new Error(
                  `expected ${entry.moduleURL.href} to be 'registered-completing-deps' but was '${depModule?.state}'`,
                );
              case 'registered-completing-deps': {
                if (
                  !stack['registered-with-deps'].includes(entry.moduleURL.href)
                ) {
                  await this.advanceToState(
                    entry.moduleURL,
                    'registered-with-deps',
                    {
                      ...stack,
                      ...{
                        'registered-with-deps': [
                          ...stack['registered-with-deps'],
                          resolvedURL.href,
                        ],
                      },
                    },
                  );
                  break outer_switch;
                } else {
                  // the dep module is actually evaluatable now--we only got
                  // here because we were already in the process of trying to
                  // move the state of the dep to 'registered-with-deps'
                  readyDeps.push({
                    type: 'dep',
                    moduleURL: entry.moduleURL,
                  });
                }
                break;
              }
              default:
                readyDeps.push({
                  type: 'dep',
                  moduleURL: entry.moduleURL,
                });
            }
          }
          this.setModule(resolvedURL.href, {
            state: 'registered-with-deps',
            implementation: module.implementation,
            dependencies: readyDeps,
          });
          break;
        }

        case 'registered-with-deps':
          if (targetState === 'registered-with-deps') {
            return;
          }
          this.evaluate(resolvedURL.href, module);
          break;
        case 'broken':
          return;
        case 'evaluated':
        case 'preparing':
          return;
        default:
          throw assertNever(module);
      }
    }
  }

  private asRequest(
    urlOrRequest: string | URL | Request,
    init?: RequestInit,
  ): Request {
    if (urlOrRequest instanceof Request && !init) {
      return urlOrRequest;
    }
    return new Request(urlOrRequest, init);
  }

  private _fetch = async (
    urlOrRequest: string | URL | Request,
    init?: RequestInit,
  ): Promise<MaybeCachedResponse> => {
    try {
      let shimmedModule = this.moduleShims.get(
        this.asRequest(urlOrRequest, init).url,
      );
      if (shimmedModule) {
        let response = new Response();
        (response as any)[Symbol.for('shimmed-module')] = shimmedModule;
        return response;
      }

      let request = this.asRequest(urlOrRequest, init);
      return await cachedFetch(this.fetchImplementation, request);
    } catch (err: any) {
      let url =
        urlOrRequest instanceof Request
          ? urlOrRequest.url
          : String(urlOrRequest);
      // `err.code` is present in Node (undici surfaces ECONNREFUSED /
      // ENOTFOUND / etc.) but absent in browsers — Chromium logs the
      // underlying `net::ERR_*` through its own network-layer channel
      // rather than the JS Error. Include whatever's available so the
      // synthetic Response carries the most specific detail we can get
      // wherever the loader runs.
      let detail = err?.code
        ? `${err.message} (${err.code})`
        : (err?.message ?? String(err));
      this.log.error(`fetch failed for ${url}: ${detail}`, err);

      let synthetic = new Response(`fetch failed for ${url}: ${detail}`, {
        status: 500,
        statusText: detail.slice(0, 200) || 'fetch failed',
      });
      // Mark this Response as a transport-level (server-unreachable) failure.
      // The thrown CardError above this gets flagged downstream so callers
      // know not to poison the module cache with this exception — a
      // "Failed to fetch" means the server wasn't there, not that the
      // module is broken.
      (synthetic as any)[Symbol.for('boxel-loader-transient-fetch-failure')] =
        true;
      return synthetic;
    }
  };

  private getModule(moduleIdentifier: string): Module | undefined {
    return this.modules.get(trimModuleIdentifier(moduleIdentifier));
  }

  private setModule(moduleIdentifier: string, module: Module) {
    this.modules.set(trimModuleIdentifier(moduleIdentifier), module);
  }

  private setCanonicalModuleURL(
    moduleIdentifier: string,
    canonicalURL: string,
  ) {
    this.moduleCanonicalURLs.set(
      trimModuleIdentifier(moduleIdentifier),
      canonicalURL,
    );
  }

  private getCanonicalModuleURL(moduleIdentifier: string): string | undefined {
    return this.moduleCanonicalURLs.get(trimModuleIdentifier(moduleIdentifier));
  }

  private captureIdentitiesOfModuleExports(
    module: any,
    moduleIdentifier: string,
  ) {
    let trimmed = trimModuleIdentifier(moduleIdentifier);
    let moduleId = this.virtualNetwork
      ? this.virtualNetwork.unresolveURL(trimmed)
      : trimmed;
    for (let propName of Object.keys(module)) {
      let exportedEntity = module[propName];
      if (
        typeof exportedEntity === 'function' &&
        typeof propName === 'string' &&
        !this.identities.has(exportedEntity)
      ) {
        this.identities.set(exportedEntity, {
          module: moduleId,
          name: propName,
        });
        Loader.loaders.set(exportedEntity, this);
      }
    }
  }

  private readOnlyProxy(module: any) {
    return new Proxy(module, {
      set(_target, prop) {
        throw new TypeError(
          `Failed to set the '${String(
            prop,
          )}' property on 'Module': Cannot assign to read only property '${String(
            prop,
          )}'`,
        );
      },
    });
  }

  private async fetchModule(moduleURL: URL): Promise<void> {
    let moduleIdentifier =
      typeof moduleURL === 'string' ? moduleURL : moduleURL.href;

    this.log.debug(
      `loader cache miss for ${moduleURL.href}, fetching this module...`,
    );
    let module = {
      state: 'fetching' as const,
      deferred: new Deferred<void>(),
      originalURL: moduleIdentifier,
    };
    this.setModule(moduleIdentifier, module);

    let loaded:
      | { type: 'source'; source: string; url: string }
      | { type: 'shimmed'; module: Record<string, unknown>; url: string };

    try {
      loaded = await this.load(moduleURL);
    } catch (exception) {
      if (
        (exception as { isTransientFetchFailure?: boolean })
          ?.isTransientFetchFailure
      ) {
        // Inability to talk to the server isn't a deterministic property
        // of the module — caching this as `broken` would poison the
        // module entry for the lifetime of this loader (every future
        // `import` would rethrow without retrying). Drop the entry so
        // the next `import` re-enters `fetchModule` and refetches.
        this.modules.delete(trimModuleIdentifier(moduleIdentifier));
      } else {
        this.setModule(moduleIdentifier, {
          state: 'broken',
          exception,
          consumedModules: new Set(), // we blew up before we could understand what was inside ourselves
        });
      }
      module.deferred.fulfill();
      throw exception;
    }

    let canonicalURL =
      loaded.url ||
      this.getCanonicalModuleURL(moduleIdentifier) ||
      moduleIdentifier;
    this.setCanonicalModuleURL(moduleIdentifier, canonicalURL);

    if (loaded.type === 'shimmed') {
      this.captureIdentitiesOfModuleExports(loaded.module, moduleIdentifier);

      this.setModule(moduleIdentifier, {
        state: 'evaluated',
        moduleInstance: loaded.module,
        consumedModules: new Set(),
      });
      module.deferred.fulfill();
      return;
    }

    let src: string;

    try {
      src = transpileAmd(loaded.source, { moduleId: moduleIdentifier });
    } catch (exception) {
      this.setModule(moduleIdentifier, {
        state: 'broken',
        exception,
        consumedModules: new Set(), // we blew up before we could understand what was inside ourselves
      });
      module.deferred.fulfill();
      throw exception;
    }

    type DefineFunc = ((
      mid: string,
      depList: string[],
      impl: Function,
    ) => void) & {
      dependencyList: UnregisteredDep[];
      implementation: Function;
    };

    // this local is here for the evals to see. We're sticking the
    // dependencyList and implementation onto the function itself because that's
    // a convenient way to ensure that build tools like Rollup don't optimize it
    // away. Rollup violates the JS spec by removing a local that's visible to `eval`.
    let define = ((_mid: string, depList: string[], impl: Function) => {
      define.dependencyList = depList.map((depId) => {
        if (depId === 'exports') {
          return { type: 'exports' };
        } else if (depId === '__import_meta__') {
          return { type: '__import_meta__' };
        } else {
          return {
            type: 'dep',
            moduleURL: new URL(
              this.resolveImport(depId),
              new URL(moduleIdentifier),
            ),
          };
        }
      });
      define.implementation = impl;
    }) as DefineFunc;

    try {
      // Append `sourceURL` so stack traces from inside the eval-ed AMD
      // module name the original module URL instead of `<anonymous>`.
      // Strip any CR/LF from the identifier so a maliciously-crafted
      // module URL can't terminate the comment and inject extra source
      // text into the eval-ed program.
      eval(src + '\n//# sourceURL=' + moduleIdentifier.replace(/[\r\n]/g, ''));
    } catch (exception) {
      this.setModule(moduleIdentifier, {
        state: 'broken',
        exception,
        consumedModules: new Set(), // we blew up before we could understand what was inside ourselves
      });
      module.deferred.fulfill();
      throw exception;
    }

    let registeredModule: RegisteredModule = {
      state: 'registered',
      dependencyList: define.dependencyList,
      implementation: define.implementation,
    };

    this.setModule(moduleIdentifier, registeredModule);
    module.deferred.fulfill();
    this.prefetchDependencies(registeredModule.dependencyList);
  }

  private evaluate<T>(moduleIdentifier: string, module: EvaluatableModule): T {
    if (module.state === 'broken') {
      throw module.exception;
    }
    if (module.state === 'evaluated' || module.state === 'preparing') {
      return module.moduleInstance as T;
    }

    let privateModuleInstance = Object.create(null);
    let moduleProxy = this.readOnlyProxy(privateModuleInstance);
    let consumedModules = new Set(
      flatMap(module.dependencies, (dep) =>
        dep.type === 'dep' ? [dep.moduleURL.href] : [],
      ),
    );

    this.setModule(moduleIdentifier, {
      state: 'preparing',
      implementation: module.implementation,
      moduleInstance: moduleProxy,
      consumedModules,
    });

    try {
      let dependencies = module.dependencies.map((entry) => {
        switch (entry.type) {
          case 'exports':
            return privateModuleInstance;
          case '__import_meta__':
            return {
              url:
                this.getCanonicalModuleURL(moduleIdentifier) ??
                moduleIdentifier,
              loader: this,
            };
          case 'completing-dep':
          case 'dep': {
            let depModule = this.getModule(entry.moduleURL.href);
            if (!isEvaluatable(depModule)) {
              throw new Error(
                `Cannot evaluate the module ${entry.moduleURL.href}, it is not evaluatable--it is in state '${depModule?.state}'`,
              );
            }
            return this.evaluate(entry.moduleURL.href, depModule!);
          }
          default:
            throw assertNever(entry);
        }
      });
      // CS-10872: timed + breadcrumbed so a Glimmer-compile-heavy
      // module that blocks the event loop is identifiable after
      // the fact (or mid-stall, if a diagnostic read happens to
      // squeeze in between two evaluate() calls in a fan-out).
      // `performance.now()` isn't universally available in every
      // runtime this code runs in (e.g. older Node test harness);
      // fall back to Date.now() which is always present and still
      // gives ms-accuracy — good enough for "this eval took 40s".
      let previouslyEvaluating = this.#currentlyEvaluatingModule;
      this.#currentlyEvaluatingModule = moduleIdentifier;
      let evalStart =
        typeof performance !== 'undefined' && performance.now
          ? performance.now()
          : Date.now();
      try {
        module.implementation(...dependencies);
      } finally {
        let evalEnd =
          typeof performance !== 'undefined' && performance.now
            ? performance.now()
            : Date.now();
        this.recordModuleEvaluation(
          moduleIdentifier,
          Math.round(evalEnd - evalStart),
        );
        this.#currentlyEvaluatingModule = previouslyEvaluating;
      }
      this.captureIdentitiesOfModuleExports(moduleProxy, moduleIdentifier);
      this.setModule(moduleIdentifier, {
        state: 'evaluated',
        moduleInstance: moduleProxy,
        consumedModules,
      });
      return moduleProxy;
    } catch (exception) {
      this.setModule(moduleIdentifier, {
        state: 'broken',
        exception,
        consumedModules,
      });
      throw exception;
    }
  }

  private async load(
    moduleURL: URL,
  ): Promise<
    | { type: 'source'; source: string; url: string }
    | { type: 'shimmed'; module: Record<string, unknown>; url: string }
  > {
    let response: MaybeCachedResponse;
    try {
      // Retry transient upstream 5xx responses (502/503/504) with short
      // backoff before surfacing as an error — see CS-10820. Note that
      // _fetch converts network failures into synthetic 500 Responses
      // (see _fetch above), so those failures are non-retryable at this
      // layer and surface below as a CardError rather than reaching this
      // catch as thrown exceptions. The catch here is defensive for any
      // other unexpected throw from the fetch helper itself.
      response = await fetchWithTransientRetry(() => this._fetch(moduleURL), {
        sleep: this.retrySleep,
        onRetry: ({ attempt, maxAttempts, status, delayMs }) => {
          this.log.debug(
            `retrying module fetch for ${moduleURL.href} after status ${status} (attempt ${attempt} of ${maxAttempts}, waiting ${delayMs}ms)`,
          );
        },
        dispose: (discarded) => {
          // Release the unread body so Node's undici (and any fetch impl
          // that gates socket reuse on body consumption) can free the
          // connection before we sleep + retry.
          discarded.body?.cancel?.().catch(() => {
            // best-effort; don't let disposal failures mask the retry path
          });
        },
      });
    } catch (err) {
      this.log.error(`fetch failed for ${moduleURL}`, err); // to aid in debugging, since this exception doesn't include the URL that failed
      // this particular exception might not be worth caching the module in a
      // "broken" state, since the server hosting the module is likely down. it
      // might be a good idea to be able to try again in this case...
      throw err;
    }
    if (!response.ok) {
      let iconMessage = iconNotFoundMessage(moduleURL.href, response.status);
      if (iconMessage) {
        // Surface a user-actionable message for a missing boxel icon instead of
        // the raw S3 AccessDenied XML. The host's browser loader rewrites these
        // to a fallback icon module, but the indexing worker's loader has no
        // such middleware, so without this the XML lands in error_doc.message.
        throw new CardError(iconMessage, {
          id: moduleURL.href,
          title: response.statusText,
          status: response.status,
          responseText: await response.text(),
        });
      }
      let error = await CardError.fromFetchResponse(moduleURL.href, response);
      // Surfaced from `_fetch`'s catch: the request never reached the
      // server. Tag the error so `fetchModule` skips caching it as a
      // broken module — transport-level failures are non-deterministic
      // and the next import should retry rather than replay this error.
      if (
        (response as unknown as Record<symbol, unknown>)[
          Symbol.for('boxel-loader-transient-fetch-failure')
        ]
      ) {
        (
          error as CardError & { isTransientFetchFailure?: boolean }
        ).isTransientFetchFailure = true;
      }
      throw error;
    }

    let canonicalPath = response.headers.get('X-Boxel-Canonical-Path');
    let canonicalURL = canonicalPath
      ? new URL(canonicalPath, moduleURL).href
      : response.url || moduleURL.href;

    if (Symbol.for('shimmed-module') in response) {
      return {
        type: 'shimmed',
        module: (response as any)[Symbol.for('shimmed-module')],
        url: canonicalURL,
      };
    }
    let source = await response.text();
    response.cacheResponse?.(source);
    return { type: 'source', source, url: canonicalURL };
  }

  private prefetchDependencies(dependencyList: UnregisteredDep[]) {
    for (let entry of dependencyList) {
      if (entry.type !== 'dep') {
        continue;
      }
      this.prefetchModule(entry.moduleURL);
    }
  }

  private prefetchModule(moduleURL: URL) {
    let module = this.getModule(moduleURL.href);
    if (module) {
      return;
    }

    let maybeFetch = this.fetchModule(moduleURL);
    maybeFetch.catch((error) => {
      this.log.debug(
        `prefetch failed for ${moduleURL.href} (will surface on demand)`,
        error,
      );
    });
  }
}

function assertNever(value: never) {
  throw new Error(`should never happen ${value}`);
}

// Cache and use string operations to avoid expensive URL construction on every
// getModule/setModule call. Module identifiers are always full URL strings so
// we only need to strip executable extensions from the end.
const trimCache = new Map<string, string>();
function trimModuleIdentifier(moduleIdentifier: string): string {
  let cached = trimCache.get(moduleIdentifier);
  if (cached !== undefined) {
    return cached;
  }
  let result = moduleIdentifier;
  for (let ext of executableExtensions) {
    if (moduleIdentifier.endsWith(ext)) {
      result = moduleIdentifier.slice(0, -ext.length);
      break;
    }
  }
  trimCache.set(moduleIdentifier, result);
  return result;
}

type ModuleState = Module['state'];
const stateOrder: {
  [key in ModuleState]: number;
} = {
  fetching: 0,
  registered: 1,
  'registered-completing-deps': 2,
  'registered-with-deps': 3,
  preparing: 4,
  evaluated: 5,
  broken: 6,
};

function isRegistered(
  module: Module | undefined,
): module is
  | EvaluatableModule
  | RegisteredCompletingDepsModule
  | RegisteredModule {
  if (!module) {
    return false;
  }
  return stateOrder[module.state] >= stateOrder['registered'];
}

function isEvaluatable(
  module: Module | undefined,
): module is EvaluatableModule {
  if (!module) {
    return false;
  }
  return stateOrder[module.state] >= stateOrder['registered-completing-deps'];
}
