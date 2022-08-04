// @ts-ignore
import TransformModulesAmd from "@babel/plugin-transform-modules-amd";
import { transformSync } from "@babel/core";
import { Deferred } from "./deferred";
import type { Realm } from "@cardstack/runtime-common/realm";
import { RealmPaths } from "./paths";
import { baseRealm } from "@cardstack/runtime-common";

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

export class Loader {
  private modules = new Map<string, Module>();
  private realmPath: RealmPaths | undefined;
  private baseRealmURL: string;
  private realm: Realm | undefined;

  constructor(baseRealmURL: string); // this is how realm clients can get a Loader
  constructor(realm: Realm, readFileAsText?: (url: URL) => Promise<string>); // this is how servers can get a Loader
  constructor(
    realmOrBaseRealmURL: Realm | string,
    private readFileAsText?: (url: URL) => Promise<string>
  ) {
    if (typeof realmOrBaseRealmURL === "string") {
      this.baseRealmURL = realmOrBaseRealmURL;
    } else {
      this.realm = realmOrBaseRealmURL;
      this.baseRealmURL = realmOrBaseRealmURL.baseRealmURL;
      this.realmPath = new RealmPaths(this.realm.url);
    }
  }

  static async forOwnRealm(moduleURL: string): Promise<Loader> {
    let response = await fetch(`${moduleURL}/_baseRealm`, {
      headers: {
        Accept: "application/vnd.api+json",
      },
    });
    if (!response.ok) {
      throw new Error(
        `could not fetch ${moduleURL}/_baseRealm: ${
          response.status
        } - ${await response.text()}`
      );
    }
    let {
      data: {
        attributes: { url },
      },
    } = await response.json();
    return new Loader(url);
  }

  async load<T extends object>(moduleIdentifier: string): Promise<T> {
    moduleIdentifier = this.resolveModule(moduleIdentifier);
    let module = await this.fetchModule(moduleIdentifier);
    switch (module.state) {
      case "fetching":
        await module.deferred.promise;
        return this.evaluateModule(moduleIdentifier);
      case "preparing":
      case "evaluated":
        return module.moduleInstance as T;
      case "broken":
        throw module.exception;
      case "registered":
        return this.evaluateModule(moduleIdentifier);
      default:
        throw assertNever(module);
    }
  }

  clearCache() {
    this.modules = new Map();
  }

  private resolveModule(moduleIdentifier: string, relativeTo?: string): string {
    if (relativeTo) {
      moduleIdentifier = new URL(moduleIdentifier, relativeTo).href;
    }

    if (!moduleIdentifier.startsWith("http")) {
      throw new Error(
        `expected module identifier to be a URL: "${moduleIdentifier}"`
      );
    }
    let moduleURL = new URL(moduleIdentifier);
    if (baseRealm.inRealm(moduleURL)) {
      return this.baseRealmURL + baseRealm.local(moduleURL);
    }
    return moduleIdentifier;
  }

  private async fetchModule(moduleIdentifier: string): Promise<Module> {
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
      src = await this.fetch(new URL(moduleIdentifier));
    } catch (exception) {
      this.modules.set(moduleIdentifier, {
        state: "broken",
        exception,
      });
      throw exception;
    }
    src = transformSync(src, {
      plugins: [
        [TransformModulesAmd, { noInterop: true, moduleId: moduleIdentifier }],
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
        } else {
          return this.resolveModule(depId, moduleIdentifier);
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
        if (depId !== "exports") {
          return this.fetchModule(depId);
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

  private async fetch(moduleURL: URL): Promise<string> {
    if (
      this.readFileAsText &&
      this.realmPath &&
      this.realmPath.inRealm(moduleURL)
    ) {
      return await this.readFileAsText(moduleURL);
    }

    let response: Response;
    try {
      response = await fetch(moduleURL.href);
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
