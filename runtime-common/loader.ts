import TransformModulesAmdPlugin from "transform-modules-amd-plugin";
import { transformSync } from "@babel/core";
import { Deferred } from "./deferred";
import { trimExecutableExtension } from "./index";
import { RealmPaths, LocalPath } from "./paths";
import type { Realm } from "./realm";

// this represents a URL that has already been resolved to aid in documenting
// when resolution has already been performed
export interface ResolvedURL extends URL {
  _isResolved: undefined;
}

type RegisteredModule = {
  state: "registered";
  dependencyList: string[];
  implementation: Function;
  consumedModules: Set<string>;
};

// a module is in this state until its own code *and the code for all its deps*
// have been loaded. Modules move from fetching to registered depth-first.
type FetchingModule = {
  state: "fetching";

  // if you encounter a module in this state, you should wait for the deferred
  // and then retry load where you're guarantee to see a new state
  deferred: Deferred<Module>;
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
      state: "preparing";
      implementation: Function;
      moduleInstance: object;
      consumedModules: Set<string>;
    }
  | {
      state: "evaluated";
      moduleInstance: object;
      consumedModules: Set<string>;
    }
  | {
      state: "broken";
      exception: any;
      consumedModules: Set<string>;
    };

type FileLoader = (path: LocalPath) => Promise<string>;
export class Loader {
  private modules = new Map<string, Module>();
  private fileLoaders = new Map<string, FileLoader>();
  private urlMappings = new Map<RealmPaths, string>();
  private realmFetchOverride: Realm[] = [];
  private moduleShims = new Map<string, Record<string, any>>();
  private identities = new WeakMap<
    Function,
    { module: string; name: string }
  >();

  constructor() {}

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
    loader.fileLoaders = globalLoader.fileLoaders;
    loader.urlMappings = globalLoader.urlMappings;
    loader.realmFetchOverride = globalLoader.realmFetchOverride;
    return loader;
  }

  static cloneLoader(loader: Loader): Loader {
    let clone = new Loader();
    clone.fileLoaders = loader.fileLoaders;
    clone.urlMappings = loader.urlMappings;
    clone.realmFetchOverride = loader.realmFetchOverride;
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

  static addFileLoader(url: URL, fileLoader: FileLoader) {
    let loader = Loader.getLoader();
    loader.addFileLoader(url, fileLoader);
  }

  addFileLoader(url: URL, fileLoader: FileLoader) {
    this.fileLoaders.set(url.href, fileLoader);
  }

  static addURLMapping(from: URL, to: URL) {
    let loader = Loader.getLoader();
    loader.addURLMapping(from, to);
  }

  addURLMapping(from: URL, to: URL) {
    this.urlMappings.set(new RealmPaths(from), to.href);
  }

  static addRealmFetchOverride(realm: Realm) {
    let loader = Loader.getLoader();
    loader.addRealmFetchOverride(realm);
  }

  addRealmFetchOverride(realm: Realm) {
    this.realmFetchOverride.push(realm);
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
  }

  async getConsumedModules(
    moduleIdentifier: string,
    accumulator = new Set<string>()
  ): Promise<string[]> {
    if (accumulator.has(moduleIdentifier)) {
      return [];
    }

    let resolvedModuleIdentifier = this.resolve(new URL(moduleIdentifier));
    let module = this.modules.get(resolvedModuleIdentifier.href);
    if (!module || module.state === "fetching") {
      // we haven't yet tried importing the module or we are still in the process of importing the module
      try {
        let m = await this.import<Record<string, any>>(moduleIdentifier);
        if (m) {
          for (let exportName of Object.keys(m)) {
            m[exportName];
          }
        }
      } catch (err: any) {
        console.warn(
          `encountered an error trying to load the module ${moduleIdentifier}. The consumedModule result includes all the known consumed modules including the module that caused the error: ${err.message}`
        );
      }
    }
    if (module?.state === "fetching") {
      throw new Error(
        `bug: could not determine the consumed modules for ${moduleIdentifier} because it is still in "fetching" state`
      );
    }
    for (let consumed of module?.consumedModules ?? []) {
      await this.getConsumedModules(consumed, accumulator);
      accumulator.add(consumed);
    }
    return [...accumulator];
  }

  static identify(
    value: unknown
  ): { module: string; name: string } | undefined {
    if (typeof value !== "function") {
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
    if (typeof value === "function") {
      return this.identities.get(value);
    } else {
      return undefined;
    }
  }

  static getLoaderFor(value: unknown): Loader {
    if (typeof value === "function") {
      return Loader.loaders.get(value) ?? Loader.getLoader();
    }
    return Loader.getLoader();
  }

  async import<T extends object>(moduleIdentifier: string): Promise<T> {
    let resolvedModule = this.resolve(moduleIdentifier);
    let resolvedModuleIdentifier = resolvedModule.href;

    if (moduleIdentifier === "http://test-realm/test/test-cards") {
      debugger;
    }
    let shimmed = this.moduleShims.get(moduleIdentifier);
    if (shimmed) {
      return shimmed as T;
    }

    let module = await this.fetchModule(resolvedModule);
    switch (module.state) {
      case "fetching":
        await module.deferred.promise;
        return this.evaluateModule(resolvedModuleIdentifier);
      case "preparing":
      case "evaluated":
        return module.moduleInstance as T;
      case "broken":
        throw module.exception;
      case "registered":
        return this.evaluateModule(resolvedModuleIdentifier);
      default:
        throw assertNever(module);
    }
  }

  async fetch(
    urlOrRequest: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> {
    if (urlOrRequest instanceof Request) {
      for (let realm of this.realmFetchOverride) {
        if (realm.paths.inRealm(new URL(urlOrRequest.url))) {
          return await realm.handle(urlOrRequest);
        }
      }
      let request = new Request(this.resolve(urlOrRequest.url).href, {
        method: urlOrRequest.method,
        headers: urlOrRequest.headers,
        body: urlOrRequest.body,
      });
      return fetch(request);
    } else {
      for (let realm of this.realmFetchOverride) {
        if (realm.paths.inRealm(new URL(urlOrRequest))) {
          let request = new Request(
            typeof urlOrRequest === "string" ? urlOrRequest : urlOrRequest.href,
            init
          );
          return await realm.handle(request);
        }
      }
      let resolvedURL = this.resolve(urlOrRequest);
      return fetch(resolvedURL.href, init);
    }
  }

  resolve(moduleIdentifier: string | URL, relativeTo?: URL): ResolvedURL {
    let absoluteURL = new URL(moduleIdentifier, relativeTo);
    for (let [paths, to] of this.urlMappings) {
      if (paths.inRealm(absoluteURL)) {
        return new URL(paths.local(absoluteURL), to) as ResolvedURL;
      }
    }
    return absoluteURL as ResolvedURL;
  }

  reverseResolution(
    moduleIdentifier: string | ResolvedURL,
    relativeTo?: URL
  ): URL {
    let absoluteURL = new URL(moduleIdentifier, relativeTo);
    for (let [sourcePath, to] of this.urlMappings) {
      let destinationPath = new RealmPaths(to);
      if (destinationPath.inRealm(absoluteURL)) {
        return new URL(destinationPath.local(absoluteURL), sourcePath.url);
      }
    }
    return absoluteURL;
  }

  private createModuleProxy(module: any, moduleIdentifier: string) {
    return new Proxy(module, {
      get: (target, property, received) => {
        let value = Reflect.get(target, property, received);
        if (typeof value === "function" && typeof property === "string") {
          this.identities.set(value, {
            module: trimExecutableExtension(
              this.reverseResolution(moduleIdentifier)
            ).href,
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
    moduleURL: ResolvedURL,
    stack: string[] = []
  ): Promise<Module> {
    let moduleIdentifier = moduleURL.href;
    let module = this.modules.get(moduleIdentifier);
    if (module) {
      // in the event of a cycle, we have already evaluated the
      // define() since we recurse into our deps after the evaluation of the
      // define, so just return ourselves
      if (stack.includes(moduleIdentifier)) {
        return module;
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
      if (module.state === "fetching") {
        return module.deferred.promise;
      }
      return module;
    }
    module = {
      state: "fetching",
      deferred: new Deferred<Module>(),
    };
    this.modules.set(moduleIdentifier, module);

    let src: string;
    try {
      src = await this.load(moduleURL);
    } catch (exception) {
      this.modules.set(moduleIdentifier, {
        state: "broken",
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
      sourceMaps: "inline",
      filename: moduleIdentifier,
    })?.code!;

    let dependencyList: string[];
    let implementation: Function;

    // this local is here for the evals to see
    // @ts-ignore
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let define = (_mid: string, depList: string[], impl: Function) => {
      dependencyList = depList.map((depId) => {
        if (depId === "exports") {
          return "exports";
        } else if (depId === "__import_meta__") {
          return "__import_meta__";
        } else {
          return this.resolve(depId, new URL(moduleIdentifier)).href;
        }
      });
      implementation = impl;
    };

    try {
      eval(src); // + "\n//# sourceURL=" + moduleIdentifier);
    } catch (exception) {
      this.modules.set(moduleIdentifier, {
        state: "broken",
        exception,
        consumedModules: new Set(), // we blew up before we could understand what was inside ourselves
      });
      throw exception;
    }

    await Promise.all(
      dependencyList!.map(async (depId) => {
        if (depId !== "exports" && depId !== "__import_meta__") {
          return await this.fetchModule(new URL(depId) as ResolvedURL, [
            ...stack,
            moduleIdentifier,
          ]);
        }
        return undefined;
      })
    );

    let registeredModule: RegisteredModule = {
      state: "registered",
      dependencyList: dependencyList!,
      implementation: implementation!,
      consumedModules: new Set(
        dependencyList!.filter(
          (d) => !["exports", "__import_meta__"].includes(d)
        )
      ),
    };

    this.modules.set(moduleIdentifier, registeredModule);
    module.deferred.fulfill(registeredModule);
    return registeredModule;
  }

  private evaluateModule<T extends object>(moduleIdentifier: string): T {
    let module = this.modules.get(moduleIdentifier);
    if (!module) {
      throw new Error(
        `bug in module loader: can't find module. ${moduleIdentifier} should have been registered before entering evaluateModule`
      );
    }
    switch (module.state) {
      case "fetching":
        throw new Error(
          `bug in module loader: module still in fetching state. ${moduleIdentifier} should have been registered before entering evaluateModule`
        );
      case "preparing":
      case "evaluated":
        return module.moduleInstance as T;
      case "broken":
        throw module.exception;
      case "registered":
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
    this.modules.set(moduleIdentifier, {
      state: "preparing",
      implementation: module.implementation,
      moduleInstance,
      consumedModules: module.consumedModules,
    });

    try {
      let dependencies = module.dependencyList.map((dependencyIdentifier) => {
        if (dependencyIdentifier === "exports") {
          return privateModuleInstance;
        } else if (dependencyIdentifier === "__import_meta__") {
          return { url: moduleIdentifier, loader: this };
        } else {
          return this.evaluateModule(dependencyIdentifier);
        }
      });

      module.implementation(...dependencies);
      this.modules.set(moduleIdentifier, {
        state: "evaluated",
        moduleInstance,
        consumedModules: module.consumedModules,
      });
      return moduleInstance;
    } catch (exception) {
      this.modules.set(moduleIdentifier, {
        state: "broken",
        exception,
        consumedModules: module.consumedModules,
      });
      throw exception;
    }
  }

  private async load(moduleURL: ResolvedURL): Promise<string> {
    for (let [realmURL, fileLoader] of this.fileLoaders) {
      let realmPath = new RealmPaths(this.resolve(realmURL));
      if (realmPath.inRealm(moduleURL)) {
        return await fileLoader(realmPath.local(moduleURL));
      }
    }

    let response: Response;
    try {
      response = await this.fetch(moduleURL);
    } catch (err) {
      console.error(`fetch failed for ${moduleURL}`, err); // to aid in debugging, since this exception doesn't include the URL that failed
      // this particular exception might not be worth caching the module in a
      // "broken" state, since the server hosting the module is likely down. it
      // might be a good idea to be able to try again in this case...
      throw err;
    }
    if (!response.ok) {
      throw new Error(
        `Could not retrieve ${moduleURL}: ${
          response.status
        } - ${await response.text()}`
      );
    }
    return await response.text();
  }
}

function assertNever(value: never) {
  throw new Error(`should never happen ${value}`);
}
