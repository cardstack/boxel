import TransformModulesAmdPlugin from 'transform-modules-amd-plugin';
import { transformSync } from '@babel/core';
import { Deferred } from './deferred';
import { cachedFetch, type MaybeCachedResponse } from './cached-fetch';
import { trimExecutableExtension, logger } from './index';

import { CardError } from './error';
import flatMap from 'lodash/flatMap';

type FetchingModule = {
  state: 'fetching';
  deferred: Deferred<void>;
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

let nonce = 0;
export class Loader {
  nonce = nonce++; // the nonce is a useful debugging tool that let's us compare loaders
  private log = logger('loader');
  private modules = new Map<string, Module>();

  private moduleShims = new Map<string, Record<string, any>>();
  private identities = new WeakMap<
    Function,
    { module: string; name: string }
  >();
  private consumptionCache = new WeakMap<object, string[]>();
  private static loaders = new WeakMap<Function, Loader>();

  private fetchImplementation: Fetch;
  private resolveImport: (moduleIdentifier: string) => string;

  constructor(
    fetch: Fetch,
    resolveImport?: (moduleIdentifier: string) => string,
  ) {
    this.fetchImplementation = fetch;
    this.resolveImport =
      resolveImport ?? ((moduleIdentifier) => moduleIdentifier);
  }

  static cloneLoader(loader: Loader): Loader {
    let clone = new Loader(loader.fetchImplementation, loader.resolveImport);
    for (let [moduleIdentifier, module] of loader.moduleShims) {
      clone.shimModule(moduleIdentifier, module);
    }
    return clone;
  }

  shimModule(moduleIdentifier: string, module: Record<string, any>) {
    moduleIdentifier = this.resolveImport(moduleIdentifier);
    this.captureIdentitiesOfModuleExports(module, moduleIdentifier);

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
    if (consumed.includes(moduleIdentifier)) {
      return [];
    }
    // you can't consume yourself
    if (moduleIdentifier !== initialIdentifier) {
      consumed.push(moduleIdentifier);
    }

    let resolvedModuleIdentifier = new URL(moduleIdentifier);
    let module = this.getModule(resolvedModuleIdentifier.href);

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
      let cached = this.consumptionCache.get(module);
      if (cached) {
        consumed.push(...cached);
        return [...new Set(consumed)];
      }
      for (let consumedModule of module?.consumedModules ?? []) {
        await this.getConsumedModules(
          consumedModule,
          consumed,
          initialIdentifier,
        );
      }
      cached = consumed;
      this.consumptionCache.set(module, cached);

      return [...new Set(cached)]; // Get rid of duplicates
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

  async import<T extends object>(moduleIdentifier: string): Promise<T> {
    moduleIdentifier = this.resolveImport(moduleIdentifier);
    let resolvedModule = new URL(moduleIdentifier);
    let resolvedModuleIdentifier = resolvedModule.href;

    await this.advanceToState(resolvedModule, 'evaluated');
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

  private fetch = async (
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
      this.log.error(`fetch failed for ${url}`, err);

      return new Response(`fetch failed for ${url}`, {
        status: 500,
        statusText: err.message,
      });
    }
  };

  private getModule(moduleIdentifier: string): Module | undefined {
    return this.modules.get(trimModuleIdentifier(moduleIdentifier));
  }

  private setModule(moduleIdentifier: string, module: Module) {
    this.modules.set(trimModuleIdentifier(moduleIdentifier), module);
  }

  private captureIdentitiesOfModuleExports(
    module: any,
    moduleIdentifier: string,
  ) {
    let moduleId = trimExecutableExtension(new URL(moduleIdentifier)).href;
    for (let propName of Object.keys(module)) {
      let exportedEntity = module[propName];
      if (
        typeof exportedEntity === 'function' &&
        typeof propName === 'string'
      ) {
        if (!this.identities.has(exportedEntity)) {
          this.identities.set(exportedEntity, {
            module: moduleId,
            name: propName,
          });
          Loader.loaders.set(exportedEntity, this);
        }
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
    };
    this.setModule(moduleIdentifier, module);

    let loaded:
      | { type: 'source'; source: string }
      | { type: 'shimmed'; module: Record<string, unknown> };

    try {
      loaded = await this.load(moduleURL);
    } catch (exception) {
      this.setModule(moduleIdentifier, {
        state: 'broken',
        exception,
        consumedModules: new Set(), // we blew up before we could understand what was inside ourselves
      });
      throw exception;
    }

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

    let src: string | null | undefined = loaded.source;

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

    let dependencyList: UnregisteredDep[];
    let implementation: Function;

    // this local is here for the evals to see
    // @ts-ignore
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let define = (_mid: string, depList: string[], impl: Function) => {
      dependencyList = depList.map((depId) => {
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

    let registeredModule: RegisteredModule = {
      state: 'registered',
      dependencyList: dependencyList!,
      implementation: implementation!,
    };

    this.setModule(moduleIdentifier, registeredModule);
    module.deferred.fulfill();
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
            return { url: moduleIdentifier, loader: this };
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
      module.implementation(...dependencies);
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
    | { type: 'source'; source: string }
    | { type: 'shimmed'; module: Record<string, unknown> }
  > {
    let response: MaybeCachedResponse;
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

    if (Symbol.for('shimmed-module') in response) {
      return {
        type: 'shimmed',
        module: (response as any)[Symbol.for('shimmed-module')],
      };
    }
    let source = await response.text();
    response.cacheResponse?.(source);
    return { type: 'source', source };
  }
}

function assertNever(value: never) {
  throw new Error(`should never happen ${value}`);
}

function trimModuleIdentifier(moduleIdentifier: string): string {
  return trimExecutableExtension(new URL(moduleIdentifier)).href;
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
