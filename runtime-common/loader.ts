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

type FetchingModule = {
  state: "fetching";
  deferred: Deferred<any>;
};

type Module =
  | RegisteredModule
  | FetchingModule
  | {
      state: "preparing";
      implementation: Function;
      moduleInstancePromise: Promise<object>;
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
  private realmPath: RealmPaths;

  constructor(
    private realm: Realm,
    private readFileAsText: (url: URL) => Promise<string>
  ) {
    this.realmPath = new RealmPaths(realm.url);
  }

  async load<T extends object>(moduleIdentifier: string): Promise<T> {
    if (!moduleIdentifier.startsWith("http")) {
      throw new Error(
        `expected module identifier to be a URL: "${moduleIdentifier}"`
      );
    }
    moduleIdentifier = this.resolveModule(moduleIdentifier);

    let module = this.modules.get(moduleIdentifier);
    if (!module) {
      module = {
        state: "fetching",
        deferred: new Deferred<T>(),
      };
      this.modules.set(moduleIdentifier, module);
      return await this.fetchModule(moduleIdentifier, module);
    }

    switch (module.state) {
      case "fetching":
        return await (module.deferred as Deferred<T>).promise;
      case "preparing":
        return (await module.moduleInstancePromise) as T;
      case "evaluated":
        return module.moduleInstance as T;
      case "broken":
        throw module.exception;
      case "registered":
        return await this.evaluateModule(moduleIdentifier, module);
      default:
        throw assertNever(module);
    }
  }

  clearCache() {
    this.modules = new Map();
  }

  private resolveModule(moduleIdentifier: string): string {
    let moduleURL = new URL(moduleIdentifier);
    if (baseRealm.inRealm(moduleURL)) {
      return new URL(moduleURL.pathname, this.realm.baseRealmURL).href;
    }
    return moduleIdentifier;
  }

  private async fetchModule<T extends object>(
    moduleIdentifier: string,
    module: FetchingModule
  ): Promise<T> {
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

    try {
      // this local is here for the evals to see
      // @ts-ignore
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      let define = this.registerModule.bind(this);
      eval(src);
    } catch (exception) {
      this.modules.set(moduleIdentifier, {
        state: "broken",
        exception,
      });
      throw exception;
    }
    let deferred = module.deferred as Deferred<T>;
    deferred.fulfill(this.load(moduleIdentifier));
    return deferred.promise;
  }

  private async evaluateModule<T extends object>(
    moduleIdentifier: string,
    module: RegisteredModule
  ): Promise<T> {
    let moduleInstance = Object.create(null);
    let deferredModuleInstance = new Deferred<T>();
    this.modules.set(moduleIdentifier, {
      state: "preparing",
      implementation: module.implementation,
      moduleInstancePromise: deferredModuleInstance.promise,
    });

    try {
      let dependencies = await Promise.all(
        module.dependencyList.map((dependencyIdentifier) => {
          if (dependencyIdentifier === "exports") {
            return moduleInstance;
          } else {
            let absIdentifier = new URL(dependencyIdentifier, moduleIdentifier)
              .href;
            return this.load(absIdentifier);
          }
        })
      );
      module.implementation(...dependencies);
      deferredModuleInstance.fulfill(moduleInstance);
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

  private registerModule(
    moduleIdentifier: string,
    dependencyList: string[],
    implementation: Function
  ): void {
    this.modules.set(moduleIdentifier, {
      state: "registered",
      dependencyList,
      implementation,
    });
  }

  private async fetch(moduleURL: URL): Promise<string> {
    if (this.realmPath.inRealm(moduleURL)) {
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
