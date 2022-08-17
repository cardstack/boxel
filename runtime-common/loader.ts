import TransformModulesAmdPlugin from "transform-modules-amd-plugin";
import { transformSync } from "@babel/core";
import { Deferred } from "./deferred";
import { RealmPaths, LocalPath } from "./paths";
import { isNode } from "./index";

// this represents a URL that has already been resolved to aid in documenting
// when resolution has already been performed
export interface ResolvedURL extends URL {
  _isResolved: undefined;
}

type RegisteredModule = {
  state: "registered";
  dependencyList: string[];
  implementation: Function;
};

// a module is in this state until its own code *and the code for all its deps*
// have been loaded. Modules move from fetching to registered depth-first.
type FetchingModule = {
  state: "fetching";

  // if you encounter a module in this state, you should wait for the deferred
  // and then retry load where you're guarantee to see a new state
  deferred: Deferred<void>;
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
    }
  | {
      state: "evaluated";
      moduleInstance: object;
    }
  | {
      state: "broken";
      exception: any;
    };

type FileLoader = (path: LocalPath) => Promise<string>;
export class Loader {
  private modules = new Map<string, Module>();
  private fileLoaders = new Map<string, FileLoader>();
  private urlMappings = new Map<RealmPaths, string>();

  constructor() {}

  static #instance: Loader | undefined;

  private static getLoader() {
    if (!Loader.#instance) {
      Loader.#instance = new Loader();
    }
    return Loader.#instance;
  }

  static async import<T extends object>(moduleIdentifier: string): Promise<T> {
    let loader = Loader.getLoader();
    return loader.import<T>(moduleIdentifier);
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

  // TODO all the callers of this method probably need their own Loader instance instead
  static clearCache() {
    let loader = Loader.getLoader();
    loader.modules = new Map();
  }

  async import<T extends object>(moduleIdentifier: string): Promise<T> {
    let resolvedModule = this.resolve(moduleIdentifier);
    let resolvedModuleIdentifier = resolvedModule.href;
    if (
      (globalThis as any).window && // make sure we are not in a service worker
      !isNode // make sure we are not in node
    ) {
      return await import(/* webpackIgnore: true */ resolvedModuleIdentifier);
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
      let request = new Request(this.resolve(urlOrRequest.url).href, {
        method: urlOrRequest.method,
        headers: urlOrRequest.headers,
        body: urlOrRequest.body,
      });
      return fetch(request);
    } else {
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

  private async fetchModule(moduleURL: ResolvedURL): Promise<Module> {
    let moduleIdentifier = moduleURL.href;
    let module = this.modules.get(moduleIdentifier);
    if (module) {
      return module;
    }
    module = {
      state: "fetching",
      deferred: new Deferred(),
    };
    this.modules.set(moduleIdentifier, module);

    let src: string;
    try {
      src = await this.load(moduleURL);
    } catch (exception) {
      this.modules.set(moduleIdentifier, {
        state: "broken",
        exception,
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
      eval(src);
    } catch (exception) {
      this.modules.set(moduleIdentifier, {
        state: "broken",
        exception,
      });
      throw exception;
    }

    await Promise.all(
      dependencyList!.map((depId) => {
        if (depId !== "exports" && depId !== "__import_meta__") {
          return this.fetchModule(new URL(depId) as ResolvedURL);
        }
        return undefined;
      })
    );

    let registeredModule: RegisteredModule = {
      state: "registered",
      dependencyList: dependencyList!,
      implementation: implementation!,
    };

    this.modules.set(moduleIdentifier, registeredModule);
    module.deferred.fulfill();
    return registeredModule;
  }

  private evaluateModule<T extends object>(moduleIdentifier: string): T {
    let module = this.modules.get(moduleIdentifier);
    if (!module) {
      throw new Error(
        `bug in module loader. ${moduleIdentifier} should have been registered before entering evaluateModule`
      );
    }
    switch (module.state) {
      case "fetching":
        throw new Error(
          `bug in module loader. ${moduleIdentifier} should have been registered before entering evaluateModule`
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
    let moduleInstance = Object.create(null);
    this.modules.set(moduleIdentifier, {
      state: "preparing",
      implementation: module.implementation,
      moduleInstance,
    });

    try {
      let dependencies = module.dependencyList.map((dependencyIdentifier) => {
        if (dependencyIdentifier === "exports") {
          return moduleInstance;
        } else if (dependencyIdentifier === "__import_meta__") {
          return { url: moduleIdentifier };
        } else {
          return this.evaluateModule(dependencyIdentifier);
        }
      });

      module.implementation(...dependencies);
      this.modules.set(moduleIdentifier, {
        state: "evaluated",
        moduleInstance,
      });
      return moduleInstance;
    } catch (exception) {
      this.modules.set(moduleIdentifier, {
        state: "broken",
        exception,
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
