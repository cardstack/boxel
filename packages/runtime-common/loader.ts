import { transpileAmd } from './amd-transpile/index.ts';
import { Deferred } from './deferred.ts';
import { cachedFetch, type MaybeCachedResponse } from './cached-fetch.ts';
import { executableExtensions, logger } from './index.ts';

import {
  CardError,
  iconNotFoundMessage,
  stringifyErrorForLog,
} from './error.ts';
import {
  shouldTrackRuntimeModuleGraph,
  trackRuntimeModuleDependency,
  type RuntimeDependencyTrackingContext,
} from './dependency-tracker.ts';
import type { VirtualNetwork } from './virtual-network.ts';

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

export interface ModuleRegistration {
  dependencyList: string[];
  implementation: Function;
}

// Evaluates the AMD registration wrapper `transpileAmd` produces and hands
// back what the module registered. This is the seam that decides *where* a
// module's code runs: the default evaluates it in the loader's own realm,
// while a caller that must run authored code somewhere else supplies an
// evaluator whose `define` binding lives there.
//
// The contract is synchronous, which bounds where the seam applies: an
// evaluation context reachable synchronously from this loader — a SES
// Compartment is one. A context that can only be reached by message passing
// runs its own Loader on its own side of the boundary and injects its
// evaluator there, rather than answering this one.
export type ModuleEvaluator = (
  source: string,
  moduleIdentifier: string,
) => ModuleRegistration;

// The parameter names are deliberately unlikely ones: `eval` runs the module
// inside this function's scope, so every local here is a name the module can
// read instead of getting the ReferenceError an undeclared identifier owes it.
function evaluateModuleInCurrentRealm(
  amdSource: string,
  amdModuleIdentifier: string,
): ModuleRegistration {
  type DefineFunc = ((
    mid: string,
    dependencyList: string[],
    impl: Function,
  ) => void) & {
    registration?: ModuleRegistration;
  };

  // this local is here for the evals to see. We're sticking the registration
  // onto the function itself because that's a convenient way to ensure that
  // build tools like Rollup don't optimize it away. Rollup violates the JS
  // spec by removing a local that's visible to `eval`.
  let define = ((_mid: string, dependencyList: string[], impl: Function) => {
    define.registration = { dependencyList, implementation: impl };
  }) as DefineFunc;
  eval(amdSource);
  if (!define.registration) {
    throw new Error(`Module ${amdModuleIdentifier} did not register itself`);
  }
  return define.registration;
}

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
  // Cache keys of modules whose fetch answered with a host-registered value
  // instead of source (a realm or the package-shim handler marks the response
  // with `Symbol.for('shimmed-module')`). Recorded so `isShimmedModule` is
  // truthful about every shim this loader has loaded, not only the ones
  // registered here through `shimModule`. This is where nearly every shim
  // lands, because the host registers its externals on the virtual network
  // rather than on the loader.
  //
  // Deliberately not `moduleShims`, which is read for three other decisions a
  // shim discovered over the network must not change: `_fetch` answers from
  // it without going to the network, `cloneLoader` re-registers all of it into
  // the clone, and `import` skips dependency tracking for anything in it — so
  // writing there would drop index dependency edges for every realm-served
  // module after its first load.
  //
  // Keys are only stable between realm-mapping changes, so this is discarded
  // with the other mapping-derived caches when a mapping changes.
  private fetchedModuleShims = new Set<string>();
  private moduleCanonicalURLs = new Map<string, string>();
  // Cache the flattened dependency sets for evaluated modules. Once a module is
  // evaluated its consumedModules never change, so the result of
  // collectKnownModuleDependencies is stable and can be reused across repeated
  // loader.import() calls (e.g. when deserializing 22 cards of the same type).
  private knownDepsCache = new Map<string, Set<string>>();
  // Module identifier → the key it is tracked under (see trackingKey).
  private trackingKeyCache = new Map<string, string>();
  private identities = new WeakMap<
    Function,
    { module: string; name: string }
  >();
  private static loaders = new WeakMap<Function, Loader>();

  private fetchImplementation: Fetch;
  private resolveImport: (moduleIdentifier: string) => string;
  private virtualNetwork: VirtualNetwork | undefined;
  // Unsubscribe for the realm-mapping-change listener registered below. The
  // VirtualNetwork outlives any single loader (LoaderService replaces the
  // loader on every module edit / session boundary), so a loader that isn't
  // unsubscribed when it's discarded stays pinned — along with its whole
  // module cache — by the listener the network still holds. `dispose()`
  // releases it; the owner calls that before dropping the loader.
  private unsubscribeMappingChange: (() => void) | undefined;
  // When the host runs inside a prerender, `setTimeout` is suppressed by
  // the render-timer-stub so the default sleep used by
  // `fetchWithTransientRetry` would never resolve and a transient 5xx on
  // a dep fetch would hang the render until the prerender timeout. The
  // host injects a sleep that goes through the native (unblocked)
  // setTimeout so the retry actually fires.
  private retrySleep: ((ms: number) => Promise<void>) | undefined;
  private moduleEvaluator: ModuleEvaluator;
  private moduleMeta: ((moduleURL: string) => object) | undefined;

  constructor(
    fetch: Fetch,
    resolveImport?: (moduleIdentifier: string) => string,
    options?: {
      retrySleep?: (ms: number) => Promise<void>;
      virtualNetwork?: VirtualNetwork;
      moduleEvaluator?: ModuleEvaluator;
      // Receives what `import.meta.url` carries for the module: its canonical
      // URL where one is known, otherwise the identifier it was reached by.
      moduleMeta?: (moduleURL: string) => object;
    },
  ) {
    this.fetchImplementation = fetch;
    this.resolveImport =
      resolveImport ?? ((moduleIdentifier) => moduleIdentifier);
    this.retrySleep = options?.retrySleep;
    this.virtualNetwork = options?.virtualNetwork;
    this.moduleEvaluator =
      options?.moduleEvaluator ?? evaluateModuleInCurrentRealm;
    this.moduleMeta = options?.moduleMeta;
    // Module caches are keyed by canonical RRI form (see moduleCacheKey), whose
    // relationship to a real URL is only stable between realm-mapping changes.
    // Discard the RRI-keyed caches whenever a mapping is added or removed so an
    // entry can't outlive the spelling it was keyed under.
    this.unsubscribeMappingChange = this.virtualNetwork?.onMappingChange(() => {
      this.modules.clear();
      this.moduleCanonicalURLs.clear();
      this.knownDepsCache.clear();
      this.trackingKeyCache.clear();
      this.fetchedModuleShims.clear();
    });
  }

  // Release the realm-mapping-change subscription so this loader can be
  // garbage-collected once discarded. Only detaches the listener — the caches
  // are left intact because a discarded loader may still be draining in-flight
  // imports, and once nothing references it the maps are collected wholesale.
  dispose() {
    this.unsubscribeMappingChange?.();
    this.unsubscribeMappingChange = undefined;
  }

  getVirtualNetwork(): VirtualNetwork | undefined {
    return this.virtualNetwork;
  }

  static cloneLoader(loader: Loader): Loader {
    let clone = new Loader(loader.fetchImplementation, loader.resolveImport, {
      retrySleep: loader.retrySleep,
      virtualNetwork: loader.virtualNetwork,
      moduleEvaluator: loader.moduleEvaluator,
      moduleMeta: loader.moduleMeta,
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

  // A shimmed module's executable identity IS a host-registered value: the
  // module object itself is what this loader holds, whether it was registered
  // here through `shimModule` or arrived on a response that carried the value
  // in place of source. There is no source to fetch, classify, or evaluate
  // anywhere else, so callers that route execution use this to keep a shim in
  // the host runtime.
  //
  // Spelling-insensitive over the identity family `moduleCacheKey` collapses
  // (`.gts` / `.ts` / extensionless), because a shim can be registered under
  // one spelling while a captured class identity carries another.
  isShimmedModule(moduleIdentifier: string): boolean {
    let resolved = this.resolveImport(moduleIdentifier);
    if (this.moduleShims.has(resolved)) {
      return true;
    }
    let key = this.moduleCacheKey(resolved);
    if (this.fetchedModuleShims.has(key)) {
      return true;
    }
    // `moduleShims` is keyed by the identifier it was registered under, so
    // reaching the rest of the identity family means folding each one.
    for (let shimIdentifier of this.moduleShims.keys()) {
      if (this.moduleCacheKey(shimIdentifier) === key) {
        return true;
      }
    }
    return false;
  }

  // Evicts one module and the modules that transitively import it, leaving
  // every other cached module — including the ones the evicted module
  // imported — in place. Returns how many cached modules were removed.
  //
  // Importers go too because an evaluated module closed over the exports of
  // the one being replaced and would keep serving the old code. The fan-in
  // reaches only modules this loader has cached: one it never loaded holds
  // nothing that can go stale.
  invalidateModule(moduleIdentifier: string): number {
    let resolved = this.resolveImport(moduleIdentifier);
    let target: string;
    try {
      // Normalize through `URL` so a caller holding a non-canonical URL
      // spelling still names the key the module was stored under. An
      // identifier that is not a URL — what a loader with no import
      // resolution is handed, and the form `shimModule` accepts — is already
      // the key form and passes through untouched.
      target = this.moduleCacheKey(new URL(resolved).href);
    } catch (error) {
      if (!(error instanceof TypeError)) {
        throw error;
      }
      target = this.moduleCacheKey(resolved);
    }

    // Reverse the import edges in one pass over the module map, then walk out
    // from the target, so the map is scanned once rather than once per level
    // of the dependent chain.
    let importers = new Map<string, string[]>();
    for (let [key, module] of this.modules) {
      for (let dependency of this.directModuleDependencies(module)) {
        let dependencyKey = this.moduleCacheKey(dependency);
        let existing = importers.get(dependencyKey);
        if (existing) {
          existing.push(key);
        } else {
          importers.set(dependencyKey, [key]);
        }
      }
    }

    let invalidated = new Set([target]);
    let frontier = [target];
    while (frontier.length > 0) {
      for (let importer of importers.get(frontier.pop()!) ?? []) {
        if (!invalidated.has(importer)) {
          invalidated.add(importer);
          frontier.push(importer);
        }
      }
    }

    let removed = 0;
    for (let key of invalidated) {
      if (this.modules.delete(key)) {
        removed++;
      }
      this.moduleCanonicalURLs.delete(key);
      // What a module's last fetch answered with is part of what is being
      // evicted: a module that answered with a host-registered value once may
      // answer with source next time, and `isShimmedModule` would otherwise
      // keep routing that source away from evaluation. A shim registered
      // through `shimModule` is a standing registration rather than something
      // learned from a fetch, so it survives and re-serves the next import.
      this.fetchedModuleShims.delete(key);
    }
    // Any cached dependency set that reached an evicted module is stale, and
    // deciding which ones costs the same walk as recomputing them on demand.
    this.knownDepsCache.clear();
    return removed;
  }

  // The modules a cached module imports, in whatever state it is in. The
  // registered states carry their dependency list; the states past them carry
  // it as `consumedModules`. A module still fetching has named nothing yet.
  private directModuleDependencies(module: Module): string[] {
    switch (module.state) {
      case 'evaluated':
      case 'preparing':
      case 'broken':
        return [...module.consumedModules];
      case 'registered':
        return module.dependencyList.flatMap((entry) =>
          entry.type === 'dep' ? [entry.moduleURL.href] : [],
        );
      case 'registered-completing-deps':
      case 'registered-with-deps':
        return module.dependencies.flatMap((entry) =>
          entry.type === 'dep' || entry.type === 'completing-dep'
            ? [entry.moduleURL.href]
            : [],
        );
      case 'fetching':
        return [];
      default:
        throw assertNever(module);
    }
  }

  // Returns the transitive consumed modules of `moduleIdentifier` in
  // canonical identifier form: the registered realm-prefix (RRI) spelling
  // (e.g. `@cardstack/base/card-api`) when the virtual network has a matching
  // prefix mapping, otherwise the module URL. Accepts either spelling as
  // input. Callers that need a fetchable URL resolve via the virtual network
  // at the network boundary.
  async getConsumedModules(moduleIdentifier: string): Promise<string[]> {
    // Normalize to resolved URL href so that prefix-form identifiers
    // (e.g. @cardstack/catalog/...) and their resolved URL equivalents
    // are treated as the same module for cycle detection and self-exclusion.
    // The walk is Set-based and resolves each identifier once: this runs per
    // module across large dependency graphs, so an array-scan accumulator or
    // a per-identifier URL construction multiplies into real render time.
    let resolveHref = (id: string) =>
      this.virtualNetwork
        ? this.virtualNetwork.toURLHref(id)
        : new URL(id).href;
    let visited = new Set<string>();
    let walk = async (id: string, href: string): Promise<void> => {
      if (visited.has(href)) {
        return;
      }
      visited.add(href);

      let module = this.getModule(href);
      if (!module || module.state === 'fetching') {
        // we haven't yet tried importing the module or we are still in the
        // process of importing the module
        try {
          await this.import<Record<string, any>>(id);
        } catch (err: any) {
          this.log.warn(
            `encountered an error trying to load the module ${id}. The consumedModule result includes all the known consumed modules including the module that caused the error: ${err.message}`,
          );
        }
        module = this.getModule(href);
      }
      // Every state a module can be holding past `fetching` names the modules
      // it imports — the registered states in their dependency list, the states
      // past them in `consumedModules` — so every one of them has edges to
      // descend. Stopping at the two terminal states instead would truncate the
      // walk at exactly the modules an import failure leaves behind: a module
      // whose own import threw is `broken` and reports its edges, but the
      // siblings that import threw *past* are stranded in a registered state,
      // and dropping their subtrees is what leaves a failed module indexed
      // without the dependency that broke it. Editing that dependency would
      // then never invalidate it. `directModuleDependencies` reads the same
      // per-state shapes `collectKnownModuleDependencies` does, so the two
      // walks describe one loader the same way at any instant.
      if (module) {
        for (let consumedModule of this.directModuleDependencies(module)) {
          await walk(consumedModule, resolveHref(consumedModule));
        }
      }
    };
    let initialHref = resolveHref(moduleIdentifier);
    await walk(moduleIdentifier, initialHref);
    // you can't consume yourself
    visited.delete(initialHref);
    return this.canonicalizeIdentifiers(
      visited,
      this.canonicalIdentifier(initialHref),
    );
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
      // Tracked under the form the index names this module's realm by, so a
      // module reached by any of its spellings is one node rather than several.
      trackRuntimeModuleDependency(
        this.trackingKey(resolvedModuleIdentifier),
        dependencyTrackingContext,
      );
    }

    // `advanceToState` re-reads the module map after each of its own awaits,
    // but this read happens after it has resolved. An eviction landing in
    // between leaves nothing to return, so advance the replacement rather than
    // reporting the state the eviction produced as a bug.
    for (;;) {
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
      }
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

  // The key this loader files a module identifier under, resolved the way
  // `isModuleLoaded` resolves it. A caller that has to answer "was this module
  // loaded?" about a loader that no longer exists can compare a snapshot of
  // `loadedModuleKeys` against this. Returns undefined for an identifier that
  // does not resolve to a URL, which is never a key any loader holds.
  moduleKey(moduleIdentifier: string): string | undefined {
    try {
      return this.moduleCacheKey(
        new URL(this.resolveImport(moduleIdentifier)).href,
      );
    } catch (e) {
      if (e instanceof TypeError) {
        return undefined;
      }
      throw e;
    }
  }

  // Every module this loader has loaded, in the key form `moduleKey` returns.
  get loadedModuleKeys(): string[] {
    return [...this.modules.keys()];
  }

  // Synchronous sibling of `getConsumedModules` limited to modules already
  // known to this loader. Output is in the same canonical identifier form:
  // realm-prefix (RRI) spelling where a prefix mapping is registered,
  // module URL otherwise.
  getKnownConsumedModules(moduleIdentifier: string): string[] {
    let resolvedModuleIdentifier = this.resolveImport(moduleIdentifier);
    let knownDependencies = this.collectKnownModuleDependencies(
      resolvedModuleIdentifier,
    );
    // Copy rather than delete from the cached Set to avoid mutating it
    return this.canonicalizeIdentifiers(
      knownDependencies,
      this.canonicalIdentifier(resolvedModuleIdentifier),
    );
  }

  // Canonical form for module identifiers that flow out of the loader
  // (dependency lists, identities): the registered realm-prefix (RRI)
  // spelling when the virtual network has a matching mapping, otherwise the
  // identifier unchanged. Resolving back to a fetchable URL is the virtual
  // network's job at the network boundary.
  private canonicalIdentifier(moduleIdentifier: string): string {
    return this.virtualNetwork
      ? this.virtualNetwork.unresolveURL(moduleIdentifier)
      : moduleIdentifier;
  }

  // Map a set of module identifiers to canonical form, deduped (distinct
  // spellings of one module — a real URL and its virtual alias — collapse to
  // one canonical identifier) and with the module itself excluded: a module
  // doesn't consume itself, and the canonical comparison catches self
  // references under any spelling.
  private canonicalizeIdentifiers(
    identifiers: Iterable<string>,
    selfCanonical: string,
  ): string[] {
    let seen = new Set<string>();
    let result: string[] = [];
    for (let identifier of identifiers) {
      let canonical = this.canonicalIdentifier(identifier);
      if (canonical === selfCanonical || seen.has(canonical)) {
        continue;
      }
      seen.add(canonical);
      result.push(canonical);
    }
    return result;
  }

  private trackKnownModuleDependencies(
    rootModuleIdentifier: string,
    dependencyTrackingContext?: RuntimeDependencyTrackingContext,
  ): void {
    // This walk repeats on every import() of the same module (e.g. when
    // deserializing many cards of one type) yet records the identical node set
    // each time; the probe collapses repeats to one Set lookup. Scoped apart
    // from the relationship walk because this one excludes shimmed modules, so
    // the two record slightly different node sets.
    if (
      !shouldTrackRuntimeModuleGraph(
        'import',
        rootModuleIdentifier,
        dependencyTrackingContext,
      )
    ) {
      return;
    }
    for (let moduleIdentifier of this.collectKnownModuleDependencies(
      rootModuleIdentifier,
    )) {
      if (!this.moduleShims.has(moduleIdentifier)) {
        trackRuntimeModuleDependency(
          this.trackingKey(moduleIdentifier),
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
    // A walk that reached a module whose dependencies this loader does not know
    // yet — one it does not hold at all, or one still fetching — saw only part
    // of the graph. Memoizing that would outlive the gap: the cache is
    // consulted before the module map and nothing clears it when a module
    // registers, so a set collected during the gap would still be answered
    // afterwards. Every other state names its dependencies, `broken` included:
    // a module that failed before it could name any has none to know, and it
    // cannot gain any without an invalidation, which clears this cache.
    let complete = true;

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
        complete = false;
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
          complete = false;
          break;
        default:
          throw assertNever(module);
      }
    }

    if (complete) {
      this.knownDepsCache.set(rootModuleIdentifier, visited);
    }
    return visited;
  }

  private async advanceToState(
    resolvedURL: URL,
    targetState:
      | 'registered-completing-deps'
      | 'registered-with-deps'
      | 'evaluated',
    // The modules whose own advance to each state is in flight further up this
    // recursion, so a dep that lands back on one of them is a cycle edge rather
    // than work to do. Held as cache keys, the same form `getModule` looks a
    // module up under, so an ancestor reached by a different spelling of itself
    // — extensionless against `.js`, an alias against the real URL — is still
    // recognized as the ancestor it is.
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
              // A dep short of evaluatable is either a cycle edge back into a
              // walk already in flight, or work to do. Being on the stack is
              // not enough to make it the former: an ancestor is only safe to
              // record and leave to its own walk once it has registered, because
              // registering is what gives it a dependency list of its own. An
              // ancestor with no entry — or one still fetching, its caches
              // discarded by a realm-mapping change while this walk was
              // suspended — has named nothing yet, so it is work like any other
              // dep, and re-entering the state machine is what re-establishes
              // it.
              //
              // What bounds that recursion is the cache clear itself, not the
              // graph. A clear landing inside the re-fetch trips the generation
              // check in `fetchModule`, which abandons the response without
              // registering, so the level retries and finds the ancestor gone
              // again — one extra level per clear that lands inside a single
              // walk, and one more unit of work for every level, since each
              // copies and rescans the stack. Only adding or removing a realm
              // mapping fires a clear, and that happens as the process wires up
              // its realms rather than while it serves them, so a walk normally
              // spans zero of them; a walk racing an unbounded stream of them
              // descends without a bound.
              if (
                isRegistered(depModule) &&
                stack['registered-completing-deps'].includes(
                  this.moduleCacheKey(entry.moduleURL.href),
                )
              ) {
                maybeReadyDeps.push({
                  type: 'completing-dep',
                  moduleURL: entry.moduleURL,
                });
              } else {
                // we always only await the first dep that actually needs work and
                // then break back to the top-level state machine, so that we'll
                // be working from the latest state.
                await this.advanceToState(
                  entry.moduleURL,
                  'registered-completing-deps',
                  {
                    ...stack,
                    ...{
                      'registered-completing-deps': [
                        ...stack['registered-completing-deps'],
                        this.moduleCacheKey(resolvedURL.href),
                      ],
                    },
                  },
                );
                break outer_switch;
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
          this.assertEveryDepRecorded(
            resolvedURL.href,
            maybeReadyDeps,
            module.dependencyList,
          );
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
              case 'registered': {
                // A `completing-dep` is recorded while the task completing it
                // is still on its own recursion stack. A concurrent import
                // root can reach this transition while that task is suspended
                // at an await, so finding the dep not-yet-completed is a real
                // interleaving, not a broken invariant. State transitions are
                // monotonic and re-entrant, so do the pending work here and
                // re-enter the state machine rather than asserting some other
                // task already did it.
                await this.advanceToState(
                  entry.moduleURL,
                  'registered-completing-deps',
                  {
                    ...stack,
                    ...{
                      'registered-completing-deps': [
                        ...stack['registered-completing-deps'],
                        this.moduleCacheKey(resolvedURL.href),
                      ],
                    },
                  },
                );
                break outer_switch;
              }
              case 'registered-completing-deps': {
                if (
                  !stack['registered-with-deps'].includes(
                    this.moduleCacheKey(entry.moduleURL.href),
                  )
                ) {
                  await this.advanceToState(
                    entry.moduleURL,
                    'registered-with-deps',
                    {
                      ...stack,
                      ...{
                        'registered-with-deps': [
                          ...stack['registered-with-deps'],
                          this.moduleCacheKey(resolvedURL.href),
                        ],
                      },
                    },
                  );
                  break outer_switch;
                } else {
                  // A dep already being advanced to 'registered-with-deps'
                  // further up this recursion is a cycle edge: the walk holding
                  // it cannot finish until this one returns, so recursing into
                  // it would not terminate. It is recorded for what it is
                  // rather than as a plain `dep`, which would claim a module
                  // still completing its own dependencies is ready to bind.
                  // The cycle is what makes the claim unverifiable here — the
                  // dep reaches 'registered-with-deps' only after this module
                  // does — so the check that it ever became true belongs at
                  // evaluation, in `findIncompleteDependency` below.
                  readyDeps.push({
                    type: 'completing-dep',
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
          this.assertEveryDepRecorded(
            resolvedURL.href,
            readyDeps,
            module.dependencies,
          );
          this.setModule(resolvedURL.href, {
            state: 'registered-with-deps',
            implementation: module.implementation,
            dependencies: readyDeps,
          });
          break;
        }

        case 'registered-with-deps': {
          if (targetState === 'registered-with-deps') {
            return;
          }
          // `evaluate` descends the whole dependency closure in one synchronous
          // pass, so every module in it has to be past 'registered' before the
          // first factory runs; finding one that is not, it can only throw, and
          // the module it was evaluating is cached `broken` for the life of the
          // loader. Reaching 'registered-with-deps' does not establish that on
          // its own: a cycle completes one participant at a time, and each is
          // committed holding cycle edges whose targets are still completing.
          // A single walk closes that gap before returning, but the module is
          // in the map the whole time, so a concurrent import root that resumes
          // mid-cycle finds it in a state that normally licenses evaluation.
          // Advancing what the closure is still missing is what makes it true,
          // and it converges because module states only move forward.
          let incompleteDependency = this.findIncompleteDependency(
            resolvedURL.href,
          );
          if (incompleteDependency) {
            await this.advanceToState(
              incompleteDependency,
              'registered-completing-deps',
              stack,
            );
            break;
          }
          this.evaluate(resolvedURL.href, module);
          break;
        }
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

  // The first module in `moduleIdentifier`'s dependency closure that `evaluate`
  // would refuse, or undefined when the closure is ready. Mirrors the descent
  // `evaluate` makes: it follows the same dependency entries, and stops where
  // `evaluate` stops — a module already evaluated, preparing, or broken is
  // answered from its own entry without its dependencies being read, so what
  // lies beyond it cannot fail this pass either.
  //
  // Scoped to one module's closure rather than memoized across the loader
  // because completeness is a property of an instant: a module reached through
  // a cycle mid-completion is incomplete now and complete a moment later, and a
  // remembered answer would outlive the state it described. The walk is bounded
  // by the states it descends through, which a module leaves permanently, so
  // the cost falls away as the graph evaluates rather than repeating per
  // import.
  private findIncompleteDependency(moduleIdentifier: string): URL | undefined {
    let seen = new Set<string>();
    let pending: URL[] = [];
    // Only the registered states hold a dependency list to descend. The states
    // past them are where `evaluate` stops reading, and a module short of them
    // is the answer rather than something to descend into.
    let pushDependencies = (module: Module | undefined) => {
      if (
        module?.state === 'registered-completing-deps' ||
        module?.state === 'registered-with-deps'
      ) {
        for (let entry of module.dependencies) {
          if (entry.type === 'dep' || entry.type === 'completing-dep') {
            pending.push(entry.moduleURL);
          }
        }
      }
    };
    pushDependencies(this.getModule(moduleIdentifier));
    while (pending.length > 0) {
      let moduleURL = pending.pop()!;
      // Keyed the way `getModule` files a module, so a module reached by a
      // second spelling of itself is recognized as one already seen.
      let key = this.moduleCacheKey(moduleURL.href);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      let module = this.getModule(moduleURL.href);
      if (!isEvaluatable(module)) {
        return moduleURL;
      }
      pushDependencies(module);
    }
    return undefined;
  }

  // `evaluate` binds a module's factory arguments positionally from the
  // dependency list the registered-state transitions build, so a list that
  // comes out shorter than the one the module declared does not fail where the
  // entry was lost: the arguments after the gap shift down, and the factory is
  // handed either the wrong module or nothing at all. Both transitions rebuild
  // the list entry by entry and reach the commit only by running the loop to
  // completion — every path that has work to do leaves through
  // `break outer_switch` with nothing committed — so a length mismatch is a
  // dropped edge and can be nothing else. Raising here names the module that
  // dropped it instead of leaving a mis-bound factory to fail somewhere else.
  private assertEveryDepRecorded(
    moduleIdentifier: string,
    recorded: EvaluatableDep[],
    declared: (UnregisteredDep | EvaluatableDep)[],
  ) {
    if (recorded.length !== declared.length) {
      throw new Error(
        `bug: dependency list for ${moduleIdentifier} recorded ${recorded.length} of the ${declared.length} dependencies it declares`,
      );
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
      this.log.error(
        `fetch failed for ${url}: ${detail}`,
        stringifyErrorForLog(err),
      );

      let synthetic = new Response(`fetch failed for ${url}: ${detail}`, {
        status: 500,
        statusText: detail.slice(0, 200) || 'fetch failed',
      });
      return synthetic;
    }
  };

  // Cache key for the per-module maps: the canonical RRI form. Every spelling
  // of a module — its resolved real URL, the virtual-alias URL, and the RRI
  // prefix — folds to one RRI via `unresolveURL`, so a base module reached by
  // any of them shares one cached module and therefore one class object.
  // Without this collapse the spellings evaluate as distinct modules and
  // `instanceof` / polymorphic-field identity checks across them diverge.
  // Modules with no realm-prefix mapping (user realms, bare package specifiers)
  // are returned unchanged by `unresolveURL`.
  //
  // The RRI→URL relationship is only stable between realm-mapping changes, so
  // the caches keyed here are discarded whenever a mapping is added or removed
  // (see the `onMappingChange` subscription in the constructor).
  private moduleCacheKey(moduleIdentifier: string): string {
    let trimmed = trimModuleIdentifier(moduleIdentifier);
    return this.virtualNetwork
      ? this.virtualNetwork.unresolveURL(trimmed)
      : trimmed;
  }

  // The key a module is recorded under with the dependency tracker: the form
  // the index carries for that module's realm, so a dep here matches the rows
  // invalidation searches.
  //
  // A realm reached through a registered prefix is named by its RRI. A realm
  // that has only a URL mapping — the alias a test or deployment serves it
  // under — is named by that alias, not by the host actually serving it.
  // `unresolveURL` covers the first and leaves the second alone (it maps an
  // alias *to* the real URL, never back), so the alias case needs its own fold.
  // Memoized because the dependency walk re-derives the key for every module in
  // a root's transitive set on every import of that root, and the alias branch
  // below allocates a URL. Keyed by the raw identifier so the trim is memoized
  // too. Discarded with the other mapping-derived caches when a realm mapping
  // changes, since the key it produces is only stable between those changes.
  private trackingKey(moduleIdentifier: string): string {
    let cached = this.trackingKeyCache.get(moduleIdentifier);
    if (cached !== undefined) {
      return cached;
    }
    let key = this.computeTrackingKey(moduleIdentifier);
    this.trackingKeyCache.set(moduleIdentifier, key);
    return key;
  }

  private computeTrackingKey(moduleIdentifier: string): string {
    let trimmed = trimModuleIdentifier(moduleIdentifier);
    if (!this.virtualNetwork) {
      return trimmed;
    }
    let unresolved = this.virtualNetwork.unresolveURL(trimmed);
    if (unresolved !== trimmed) {
      return unresolved;
    }
    try {
      let virtual = this.virtualNetwork.mapURL(trimmed, 'real-to-virtual');
      if (virtual) {
        return virtual.href;
      }
    } catch {
      // Not a parseable URL — a prefix-form identifier, already canonical.
    }
    return trimmed;
  }

  private getModule(moduleIdentifier: string): Module | undefined {
    return this.modules.get(this.moduleCacheKey(moduleIdentifier));
  }

  private setModule(moduleIdentifier: string, module: Module) {
    this.modules.set(this.moduleCacheKey(moduleIdentifier), module);
  }

  private setCanonicalModuleURL(
    moduleIdentifier: string,
    canonicalURL: string,
  ) {
    this.moduleCanonicalURLs.set(
      this.moduleCacheKey(moduleIdentifier),
      canonicalURL,
    );
  }

  private getCanonicalModuleURL(moduleIdentifier: string): string | undefined {
    return this.moduleCanonicalURLs.get(this.moduleCacheKey(moduleIdentifier));
  }

  // Collapse a module identifier to its virtual-alias URL form when one
  // exists, so the dependency tracker keys aren't fragmented across the
  // virtual-alias (`https://cardstack.com/base/X`) and resolved real URL
  // (`https://localhost:4201/base/X`) for the same module. Returns the
  // input unchanged when no virtual alias is registered.

  private captureIdentitiesOfModuleExports(
    module: any,
    moduleIdentifier: string,
  ) {
    // Identities are recorded in canonical identifier form so that
    // `identify()` output matches the form persisted in code refs.
    let moduleId = this.canonicalIdentifier(
      trimModuleIdentifier(moduleIdentifier),
    );
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
      // `invalidateModule` may have dropped this fetch while transport was in
      // flight, and a later import may already have installed a replacement.
      // The fetching record is the generation token: a stale failure must not
      // delete or reject the newer generation.
      if (this.getModule(moduleIdentifier) !== module) {
        module.deferred.fulfill();
        return;
      }
      // A failure to OBTAIN the module — a network failure or an error
      // HTTP response — is never cached as `broken`. The modules map keys
      // entries by the extension-trimmed identifier (see
      // `trimModuleIdentifier`): one slot shared by the `.gts` / `.ts` /
      // extensionless spellings of a module. A fetch failure is a property
      // of the requested SPELLING, not of that shared identity — a 404 for
      // `foo.gts` says nothing about `foo`, which may resolve via
      // `foo.ts` — so caching it would poison every sibling import for the
      // lifetime of this loader (definition-cache population probes
      // extension candidates with real fetches, making this a routine
      // occurrence, not an edge case). Likewise a transport-level failure
      // isn't a property of the module at all. Drop the entry so the next
      // `import` re-enters `fetchModule` and refetches; failures of
      // *obtained* source (transpile / evaluate below) are deterministic
      // properties of the module and are the ones cached as `broken`.
      this.modules.delete(this.moduleCacheKey(moduleIdentifier));
      module.deferred.fulfill();
      throw exception;
    }

    // Same generation check for a response that arrives after its fetch was
    // invalidated: without it an old response restores its source and
    // dependency edges over the entry that replaced it.
    if (this.getModule(moduleIdentifier) !== module) {
      module.deferred.fulfill();
      return;
    }

    let canonicalURL =
      loaded.url ||
      this.getCanonicalModuleURL(moduleIdentifier) ||
      moduleIdentifier;
    this.setCanonicalModuleURL(moduleIdentifier, canonicalURL);

    if (loaded.type === 'shimmed') {
      this.captureIdentitiesOfModuleExports(loaded.module, moduleIdentifier);
      this.fetchedModuleShims.add(this.moduleCacheKey(moduleIdentifier));

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

    let registration: ModuleRegistration;
    let dependencyList: UnregisteredDep[];

    try {
      // Append `sourceURL` so stack traces from inside the eval-ed AMD
      // module name the original module URL instead of `<anonymous>`.
      // Strip any CR/LF from the identifier so a maliciously-crafted
      // module URL can't terminate the comment and inject extra source
      // text into the eval-ed program.
      registration = this.moduleEvaluator(
        src + '\n//# sourceURL=' + moduleIdentifier.replace(/[\r\n]/g, ''),
        moduleIdentifier,
      );
      // An evaluator is arbitrary injected code, so what comes back is
      // checked before it becomes a cached module: a registration the loader
      // can't use has to name itself here rather than surface later as a
      // shapeless failure while the module is being evaluated.
      if (
        !registration ||
        !Array.isArray(registration.dependencyList) ||
        !registration.dependencyList.every(
          (entry) => typeof entry === 'string',
        ) ||
        typeof registration.implementation !== 'function'
      ) {
        throw new Error(
          `Module evaluator returned an invalid registration for ${moduleIdentifier}`,
        );
      }
      dependencyList = registration.dependencyList.map(
        (depId): UnregisteredDep => {
          if (depId === 'exports') {
            return { type: 'exports' };
          } else if (depId === '__import_meta__') {
            return { type: '__import_meta__' };
          }
          return {
            type: 'dep',
            moduleURL: new URL(
              this.resolveImport(depId),
              new URL(moduleIdentifier),
            ),
          };
        },
      );
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
      dependencyList,
      implementation: registration.implementation,
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
    // Both edge types are imports. A `completing-dep` only records that the
    // dep had not finished completing when this module's dependency list was
    // frozen — a module reached while a concurrent import root is suspended
    // can hold its whole import list that way, cycle edges and ordinary ones
    // alike. This is the last place those edges are written down, because the
    // distinction is dropped as the module leaves the registered states, and
    // both readers of `consumedModules` need every import: eviction so a
    // module does not outlive something whose exports it holds, and the index
    // so an edit to an imported module invalidates what imported it. This set
    // is also what indexing invalidation fans out over, which is the cost of
    // anything added to it: it holds imports, and nothing that is not one.
    let consumedModules = new Set(
      module.dependencies.flatMap((dep) =>
        dep.type === 'dep' || dep.type === 'completing-dep'
          ? [dep.moduleURL.href]
          : [],
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
          case '__import_meta__': {
            let url =
              this.getCanonicalModuleURL(moduleIdentifier) ?? moduleIdentifier;
            // Whoever evaluates a module decides what `import.meta` exposes
            // to it. The default hands over the Loader itself, which is only
            // safe because the default evaluates the module in the loader's
            // own realm — code already holding everything the loader has.
            return this.moduleMeta
              ? this.moduleMeta(url)
              : { url, loader: this };
          }
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
      this.log.error(
        `fetch failed for ${moduleURL}: ${stringifyErrorForLog(err)}`,
      ); // to aid in debugging, since this exception doesn't include the URL that failed
      // this particular exception might not be worth caching the module in a
      // "broken" state, since the server hosting the module is likely down. it
      // might be a good idea to be able to try again in this case...
      throw err;
    }
    if (!response.ok) {
      let error = await CardError.fromFetchResponse(moduleURL.href, response);
      // Replace the raw S3 AccessDenied XML for a missing boxel icon with a
      // user-actionable message, while preserving everything else the base
      // error carries (status, deps, responseText). The host's browser loader
      // rewrites these failures to a fallback icon module, but the indexing
      // worker's loader has no such middleware, so without this the XML lands
      // in error_doc.message.
      let iconMessage = iconNotFoundMessage(moduleURL.href, response.status);
      if (iconMessage) {
        error.message = iconMessage;
        if (!error.deps?.length) {
          error.deps = [response.url || moduleURL.href];
        }
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
