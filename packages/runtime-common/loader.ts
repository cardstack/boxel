import TransformModulesAmdPlugin from 'transform-modules-amd-plugin';
import { transformSync } from '@babel/core';
import { Deferred } from './deferred';
import { trimExecutableExtension, logger } from './index';
import { RealmPaths } from './paths';
import { CardError } from './error';
import { type RunnerOpts } from './search-index';

const isFastBoot = typeof (globalThis as any).FastBoot !== 'undefined';

// this represents a URL that has already been resolved to aid in documenting
// when resolution has already been performed
export interface ResolvedURL extends URL {
  _isResolved: undefined;
}

function isResolvedURL(url: URL | ResolvedURL): url is ResolvedURL {
  return '_isResolved' in url;
}

function makeResolvedURL(unresolvedURL: URL | string): ResolvedURL {
  let resolvedURL = new URL(unresolvedURL) as ResolvedURL;
  resolvedURL._isResolved = undefined;
  return resolvedURL;
}

type RegisteredModule = {
  state: 'registered';
  dependencyList: string[];
  implementation: Function;
  consumedModules: Set<string>;
};

// a module is in this state until its own code *and the code for all its deps*
// have been loaded. Modules move from fetching to registered depth-first.
type FetchingModule = {
  state: 'fetching';
  // if you encounter a module in this state, you should wait for the deferred
  // and then retry load where you're guarantee to see a new state
  deferred: Deferred<Module>;
  stacks: string[][];
  defined?: {
    dependencyList: string[];
    implementation: Function;
    consumedModules: Set<string>;
  };
};

type Module =
  | FetchingModule
  | RegisteredModule
  | {
      // this state represents the *synchronous* window of time where this
      // module's dependencies are moving from registered to preparing to
      // evaluated. Because this is synchronous, you can rely on the fact that
      // encountering a load for a module that is in "preparing" means you have a
      // cycle.
      state: 'preparing';
      implementation: Function;
      moduleInstance: object;
      consumedModules: Set<string>;
    }
  | {
      state: 'evaluated';
      moduleInstance: object;
      consumedModules: Set<string>;
    }
  | {
      state: 'broken';
      exception: any;
      consumedModules: Set<string>;
    };

export interface MaybeLocalRequest extends Request {
  isLocal?: true;
}

export class Loader {
  private log = logger('loader');
  private modules = new Map<string, Module>();
  private urlHandlers = new Map<string, (req: Request) => Promise<Response>>();
  // use a tuple array instead of a map so that we can support reversing
  // different resolutions back to the same URL. the resolution that we apply
  // will be in order of precedence. consider 2 realms in the same server
  // wanting to communicate via localhost resolved URL's, but also a browser
  // that talks to the realm (we need to reverse the resolution in the server.ts
  // to figure out which realm the request is talking to)
  private urlMappings: [string, string][] = [];
  private moduleShims = new Map<string, Record<string, any>>();
  private identities = new WeakMap<
    Function,
    { module: string; name: string }
  >();
  private consumptionCache = new WeakMap<object, string[]>();

  static #instance: Loader | undefined;
  static loaders = new WeakMap<Function, Loader>();

  static getLoader() {
    if (!Loader.#instance) {
      Loader.#instance = new Loader();
    }
    return Loader.#instance;
  }

  // this will return a new loader instance that has the same file loaders and
  // url mappings as the global loader
  static createLoaderFromGlobal(): Loader {
    let globalLoader = Loader.getLoader();
    let loader = new Loader();
    loader.urlHandlers = globalLoader.urlHandlers;
    loader.urlMappings = globalLoader.urlMappings;
    for (let [moduleIdentifier, module] of globalLoader.moduleShims) {
      loader.shimModule(moduleIdentifier, module);
    }
    return loader;
  }

  static cloneLoader(loader: Loader): Loader {
    let clone = new Loader();
    clone.urlHandlers = loader.urlHandlers;
    clone.urlMappings = loader.urlMappings;
    for (let [moduleIdentifier, module] of loader.moduleShims) {
      clone.shimModule(moduleIdentifier, module);
    }
    return clone;
  }

  static async import<T extends object>(moduleIdentifier: string): Promise<T> {
    let loader = Loader.getLoader();
    return loader.import<T>(moduleIdentifier);
  }

  // FOR TESTS ONLY!
  static destroy() {
    Loader.#instance = undefined;
  }

  static resolve(
    moduleIdentifier: string | URL,
    relativeTo?: URL
  ): ResolvedURL {
    let loader = Loader.getLoader();
    return loader.resolve(moduleIdentifier, relativeTo);
  }

  static reverseResolution(
    moduleIdentifier: string | ResolvedURL,
    relativeTo?: URL
  ): URL {
    let loader = Loader.getLoader();
    return loader.reverseResolution(moduleIdentifier, relativeTo);
  }

  static async fetch(
    urlOrRequest: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> {
    let loader = Loader.getLoader();
    return loader.fetch(urlOrRequest, init);
  }

  static addURLMapping(from: URL, to: URL) {
    let loader = Loader.getLoader();
    loader.addURLMapping(from, to);
  }

  addURLMapping(from: URL, to: URL) {
    this.urlMappings.push([from.href, to.href]);
  }

  static registerURLHandler(
    url: URL,
    handler: (req: Request) => Promise<Response>
  ) {
    let loader = Loader.getLoader();
    loader.registerURLHandler(url, handler);
  }

  registerURLHandler(url: URL, handler: (req: Request) => Promise<Response>) {
    this.urlHandlers.set(url.href, handler);
  }

  static shimModule(moduleIdentifier: string, module: Record<string, any>) {
    let loader = Loader.getLoader();
    loader.shimModule(moduleIdentifier, module);
  }

  shimModule(moduleIdentifier: string, module: Record<string, any>) {
    this.moduleShims.set(
      moduleIdentifier,
      this.createModuleProxy(module, moduleIdentifier)
    );
    this.setModule(moduleIdentifier, {
      state: 'evaluated',
      moduleInstance: module,
      consumedModules: new Set(),
    });
  }

  async getConsumedModules(
    moduleIdentifier: string,
    consumed = new Set<string>()
  ): Promise<string[]> {
    if (consumed.has(moduleIdentifier)) {
      return [];
    }
    consumed.add(moduleIdentifier);

    let module: Module | undefined;
    if (isUrlLike(moduleIdentifier)) {
      let resolvedModuleIdentifier = this.resolve(new URL(moduleIdentifier));
      module = this.getModule(resolvedModuleIdentifier.href);
    } else {
      module = this.getModule(moduleIdentifier);
    }
    if (!module || module.state === 'fetching') {
      // we haven't yet tried importing the module or we are still in the process of importing the module
      try {
        let m = await this.import<Record<string, any>>(moduleIdentifier);
        if (m) {
          for (let exportName of Object.keys(m)) {
            m[exportName];
          }
        }
      } catch (err: any) {
        this.log.warn(
          `encountered an error trying to load the module ${moduleIdentifier}. The consumedModule result includes all the known consumed modules including the module that caused the error: ${err.message}`
        );
      }
    }
    if (module?.state === 'fetching') {
      throw new Error(
        `bug: could not determine the consumed modules for ${moduleIdentifier} because it is still in "fetching" state`
      );
    }
    if (module) {
      let cached = this.consumptionCache.get(module);
      if (cached) {
        return cached;
      }
      for (let consumedModule of module?.consumedModules ?? []) {
        await this.getConsumedModules(consumedModule, consumed);
      }
      cached = [...consumed];
      this.consumptionCache.set(module, cached);
      return cached;
    }
    return [];
  }

  static identify(
    value: unknown
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

  static getLoaderFor(value: unknown): Loader {
    if (typeof value === 'function') {
      return Loader.loaders.get(value) ?? Loader.getLoader();
    }
    return Loader.getLoader();
  }

  async import<T extends object>(moduleIdentifier: string): Promise<T> {
    let resolvedModule = this.resolve(moduleIdentifier);
    let resolvedModuleIdentifier = resolvedModule.href;

    let shimmed = this.moduleShims.get(moduleIdentifier);
    if (shimmed) {
      return shimmed as T;
    }

    let module = await this.fetchModule(resolvedModule);
    switch (module.state) {
      case 'fetching':
        await module.deferred.promise;
        return this.evaluateModule(resolvedModuleIdentifier);
      case 'preparing':
      case 'evaluated':
        return module.moduleInstance as T;
      case 'broken':
        throw module.exception;
      case 'registered':
        return this.evaluateModule(resolvedModuleIdentifier);
      default:
        throw assertNever(module);
    }
  }

  async fetch(
    urlOrRequest: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> {
    let requestURL = new URL(
      urlOrRequest instanceof Request
        ? urlOrRequest.url
        : typeof urlOrRequest === 'string'
        ? urlOrRequest
        : urlOrRequest.href
    );
    if (urlOrRequest instanceof Request) {
      for (let [url, handle] of this.urlHandlers) {
        let path = new RealmPaths(new URL(url));
        if (path.inRealm(requestURL)) {
          let request = urlOrRequest as MaybeLocalRequest;
          request.isLocal = true;
          return await handle(request);
        }
      }
      let request = new Request(this.resolve(requestURL).href, {
        method: urlOrRequest.method,
        headers: urlOrRequest.headers,
        body: urlOrRequest.body,
      });
      return getNativeFetch()(request);
    } else {
      let unresolvedURL =
        typeof urlOrRequest === 'string'
          ? new URL(urlOrRequest)
          : isResolvedURL(urlOrRequest)
          ? this.reverseResolution(urlOrRequest)
          : urlOrRequest;
      for (let [url, handle] of this.urlHandlers) {
        let path = new RealmPaths(new URL(url));
        if (path.inRealm(unresolvedURL)) {
          let request = new Request(
            unresolvedURL.href,
            init
          ) as MaybeLocalRequest;
          request.isLocal = true;
          return await handle(request);
        }
      }
      return getNativeFetch()(this.resolve(unresolvedURL).href, init);
    }
  }

  resolve(moduleIdentifier: string | URL, relativeTo?: URL): ResolvedURL {
    let absoluteURL = new URL(moduleIdentifier, relativeTo);
    for (let [sourceURL, to] of this.urlMappings) {
      let sourcePath = new RealmPaths(new URL(sourceURL));
      if (sourcePath.inRealm(absoluteURL)) {
        let toPath = new RealmPaths(new URL(to));
        if (absoluteURL.href.endsWith('/')) {
          return makeResolvedURL(
            toPath.directoryURL(sourcePath.local(absoluteURL))
          );
        } else {
          return makeResolvedURL(
            toPath.fileURL(
              sourcePath.local(absoluteURL, { preserveQuerystring: true })
            )
          );
        }
      }
    }
    return makeResolvedURL(absoluteURL);
  }

  reverseResolution(
    moduleIdentifier: string | ResolvedURL,
    relativeTo?: URL
  ): URL {
    let absoluteURL = new URL(moduleIdentifier, relativeTo);
    for (let [sourceURL, to] of this.urlMappings) {
      let sourcePath = new RealmPaths(new URL(sourceURL));
      let destinationPath = new RealmPaths(to);
      if (destinationPath.inRealm(absoluteURL)) {
        if (absoluteURL.href.endsWith('/')) {
          return sourcePath.directoryURL(destinationPath.local(absoluteURL));
        } else {
          return sourcePath.fileURL(
            destinationPath.local(absoluteURL, { preserveQuerystring: true })
          );
        }
      }
    }
    return absoluteURL;
  }

  private getModule(moduleIdentifier: string): Module | undefined {
    return this.modules.get(trimModuleIdentifier(moduleIdentifier));
  }

  private setModule(moduleIdentifier: string, module: Module) {
    this.modules.set(trimModuleIdentifier(moduleIdentifier), module);
  }

  private createModuleProxy(module: any, moduleIdentifier: string) {
    return new Proxy(module, {
      get: (target, property, received) => {
        let value = Reflect.get(target, property, received);
        if (typeof value === 'function' && typeof property === 'string') {
          this.identities.set(value, {
            module: isUrlLike(moduleIdentifier)
              ? trimExecutableExtension(
                  this.reverseResolution(moduleIdentifier)
                ).href
              : moduleIdentifier,
            name: property,
          });
          Loader.loaders.set(value, this);
        }
        return value;
      },
      set() {
        throw new Error(`modules are read only`);
      },
    });
  }

  private async fetchModule(
    moduleURL: ResolvedURL | string,
    stack: string[] = []
  ): Promise<Module> {
    let start = Date.now();
    let moduleIdentifier =
      typeof moduleURL === 'string' ? moduleURL : moduleURL.href;
    let module = this.getModule(moduleIdentifier);
    let trimmedIdentifier = trimModuleIdentifier(moduleIdentifier);
    if (module) {
      // in the event of a cycle, we have already evaluated the
      // define() since we recurse into our deps after the evaluation of the
      // define, so just return ourselves
      if (stack.includes(trimmedIdentifier)) {
        return module;
      }

      // if we see that our fetch is stuck in a deadlock, then we'll transition
      // our module to the registered state since it has been defined already.
      if (module.state === 'fetching' && stack.length > 0) {
        let deadlock = [...this.modules].find(
          ([identifier, m]) =>
            m.state === 'fetching' &&
            m.stacks.find((s) => s.includes(trimmedIdentifier)) &&
            stack.includes(identifier)
        );
        if (deadlock && module.defined) {
          let { dependencyList, implementation, consumedModules } =
            module.defined;
          let registeredModule: RegisteredModule = {
            state: 'registered',
            dependencyList,
            implementation,
            consumedModules,
          };
          this.setModule(moduleIdentifier, registeredModule);
          console.log(`registered module ${moduleIdentifier}`);
          module.deferred.fulfill(registeredModule);
          return registeredModule;
        }
      }

      // this closes an otherwise leaky async when there are simultaneous
      // imports for modules that share a common dep, e.g. where you request
      // module a and b simultaneously for the following consumption pattern
      // (also included in our tests):
      //   a -> b -> c
      //
      // In that case both of the imports will try to fetch c, one of them will
      // start the actual fetch, and the other will short circuit and just
      // return the cached module in a fetching state. the consumer of the short
      // circuited module will assume that the dep has already been registered
      // and immediately proceed to evaluation--when in fact the dep is still
      // being loaded. to make sure that the consumer will wait until the dep
      // has actually completed loading we need to return the deferred promise
      // of the cached module.
      if (module.state === 'fetching') {
        module.stacks.push(stack);
        return module.deferred.promise;
      }
      return module;
    }
    if (typeof moduleURL === 'string') {
      let exception = new Error(
        `the module '${moduleURL}' appears to be an npm package without a shim. We only support shimmed npm packages, otherwise provide a full URL to the module (e.g. unpkg url for module)`
      );
      this.setModule(moduleIdentifier, {
        state: 'broken',
        exception,
        consumedModules: new Set(),
      });
      throw exception;
    }
    this.log.debug(
      `loader cache miss for ${moduleURL.href}, fetching this module...`
    );
    module = {
      state: 'fetching',
      deferred: new Deferred<Module>(),
      stacks: [stack],
    };
    this.setModule(moduleIdentifier, module);

    let src: string | null | undefined;
    try {
      src = await this.load(moduleURL);
    } catch (exception) {
      this.setModule(moduleIdentifier, {
        state: 'broken',
        exception,
        consumedModules: new Set(), // we blew up before we could understand what was inside ourselves
      });
      throw exception;
    }
    src = transformSync(src, {
      plugins: [
        [
          TransformModulesAmdPlugin,
          { noInterop: true, moduleId: moduleIdentifier },
        ],
      ],
      sourceMaps: 'inline',
      filename: moduleIdentifier,
    })?.code;
    if (!src) {
      throw new Error(`bug: should never get here`);
    }

    let dependencyList: string[];
    let implementation: Function;

    // this local is here for the evals to see
    // @ts-ignore
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let define = (_mid: string, depList: string[], impl: Function) => {
      dependencyList = depList.map((depId) => {
        if (depId === 'exports') {
          return 'exports';
        } else if (depId === '__import_meta__') {
          return '__import_meta__';
        } else if (isUrlLike(depId)) {
          return this.resolve(depId, new URL(moduleIdentifier)).href;
        } else {
          return depId; // for npm imports
        }
      });
      implementation = impl;
    };

    try {
      eval(src); // + "\n//# sourceURL=" + moduleIdentifier);
    } catch (exception) {
      this.setModule(moduleIdentifier, {
        state: 'broken',
        exception,
        consumedModules: new Set(), // we blew up before we could understand what was inside ourselves
      });
      throw exception;
    }
    module.defined = {
      implementation: implementation!,
      dependencyList: dependencyList!,
      consumedModules: new Set(
        dependencyList!.filter(
          (d) => !['exports', '__import_meta__'].includes(d)
        )
      ),
    };

    await Promise.all(
      dependencyList!.map(async (depId) => {
        if (depId !== 'exports' && depId !== '__import_meta__') {
          return await this.fetchModule(
            isUrlLike(depId) ? makeResolvedURL(depId) : depId,
            [
              ...stack,
              isUrlLike(moduleIdentifier)
                ? trimExecutableExtension(new URL(moduleIdentifier)).href
                : moduleIdentifier,
            ]
          );
        }
        return undefined;
      })
    );

    let registeredModule: RegisteredModule = {
      state: 'registered',
      dependencyList: dependencyList!,
      implementation: implementation!,
      consumedModules: new Set(
        dependencyList!.filter(
          (d) => !['exports', '__import_meta__'].includes(d)
        )
      ),
    };

    this.setModule(moduleIdentifier, registeredModule);
    module.deferred.fulfill(registeredModule);
    if (stack.length === 0) {
      this.log.debug(
        `loader fetch for ${moduleURL} (including deps) took ${
          Date.now() - start
        }ms`
      );
    }
    return registeredModule;
  }

  private evaluateModule<T extends object>(moduleIdentifier: string): T {
    let module = this.getModule(moduleIdentifier);
    if (!module) {
      throw new Error(
        `bug in module loader: can't find module. ${moduleIdentifier} should have been registered before entering evaluateModule`
      );
    }
    switch (module.state) {
      case 'fetching':
        throw new Error(
          `bug in module loader: module still in fetching state. ${moduleIdentifier} should have been registered before entering evaluateModule`
        );
      case 'preparing':
      case 'evaluated':
        return module.moduleInstance as T;
      case 'broken':
        throw module.exception;
      case 'registered':
        return this.evaluate(moduleIdentifier, module);
      default:
        throw assertNever(module);
    }
  }

  private evaluate<T>(moduleIdentifier: string, module: RegisteredModule): T {
    let privateModuleInstance = Object.create(null);
    let moduleInstance = this.createModuleProxy(
      privateModuleInstance,
      moduleIdentifier
    );
    this.setModule(moduleIdentifier, {
      state: 'preparing',
      implementation: module.implementation,
      moduleInstance,
      consumedModules: module.consumedModules,
    });

    try {
      let dependencies = module.dependencyList.map((dependencyIdentifier) => {
        if (dependencyIdentifier === 'exports') {
          return privateModuleInstance;
        } else if (dependencyIdentifier === '__import_meta__') {
          return { url: moduleIdentifier, loader: this };
        } else {
          return this.evaluateModule(dependencyIdentifier);
        }
      });

      module.implementation(...dependencies);
      this.setModule(moduleIdentifier, {
        state: 'evaluated',
        moduleInstance,
        consumedModules: module.consumedModules,
      });
      return moduleInstance;
    } catch (exception) {
      this.setModule(moduleIdentifier, {
        state: 'broken',
        exception,
        consumedModules: module.consumedModules,
      });
      throw exception;
    }
  }

  private async load(moduleURL: ResolvedURL): Promise<string> {
    let response: Response;
    try {
      response = await this.fetch(moduleURL);
    } catch (err) {
      this.log.error(`fetch failed for ${moduleURL}`, err); // to aid in debugging, since this exception doesn't include the URL that failed
      // this particular exception might not be worth caching the module in a
      // "broken" state, since the server hosting the module is likely down. it
      // might be a good idea to be able to try again in this case...
      throw err;
    }
    if (!response.ok) {
      let error = await CardError.fromFetchResponse(moduleURL.href, response);
      throw error;
    }
    return await response.text();
  }
}

function getNativeFetch(): typeof fetch {
  if (isFastBoot) {
    let optsId = (globalThis as any).runnerOptsId;
    if (optsId == null) {
      throw new Error(`Runner Options Identifier was not set`);
    }
    let getRunnerOpts = (globalThis as any).getRunnerOpts as (
      optsId: number
    ) => RunnerOpts;
    return getRunnerOpts(optsId)._fetch;
  } else {
    return fetch;
  }
}

function assertNever(value: never) {
  throw new Error(`should never happen ${value}`);
}

function isUrlLike(moduleIdentifier: string): boolean {
  return (
    moduleIdentifier.startsWith('.') ||
    moduleIdentifier.startsWith('/') ||
    moduleIdentifier.startsWith('http://') ||
    moduleIdentifier.startsWith('https://')
  );
}

function trimModuleIdentifier(moduleIdentifier: string): string {
  return isUrlLike(moduleIdentifier)
    ? trimExecutableExtension(new URL(moduleIdentifier)).href
    : moduleIdentifier;
}
