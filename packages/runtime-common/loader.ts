import TransformModulesAmdPlugin from 'transform-modules-amd-plugin';
import { transformSync } from '@babel/core';
import { Deferred } from './deferred';
import { trimExecutableExtension, logger } from './index';

import { CardError } from './error';
import flatMap from 'lodash/flatMap';
import { decodeScopedCSSRequest, isScopedCSSRequest } from 'glimmer-scoped-css';
import jsEscapeString from 'js-string-escape';

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
  private urlHandlers: RequestHandler[] = [maybeHandleScopedCSSRequest];

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
    clone.urlHandlers = loader.urlHandlers;
    clone.urlMappings = loader.urlMappings;
    for (let [moduleIdentifier, module] of loader.moduleShims) {
      clone.shimModule(moduleIdentifier, module);
    }
    return clone;
  }

  registerURLHandler(handler: RequestHandler) {
    this.urlHandlers.push(handler);
  }

  prependURLHandlers(handlers: RequestHandler[]) {
    this.urlHandlers = [...handlers, ...this.urlHandlers];
  }

  shimModule(moduleIdentifier: string, module: Record<string, any>) {
    moduleIdentifier = this.resolveImport(moduleIdentifier);
    let proxiedModule = this.createModuleProxy(module, moduleIdentifier);

    for (let propName of Object.keys(module)) {
      // Normal modules always end up in our identity map because the only way for other code to gain access to the module's exports is by getting it through the
      // proxy our loader has wrapped around it. But shimmed modules may be used directly by our caller before we've had a chance to put them in the dientity map.
      // So this eagerly puts them into the identity map.
      proxiedModule[propName]; // Makes sure the shimmed modules get into the identity map.
    }

    this.moduleShims.set(moduleIdentifier, proxiedModule);

    this.setModule(moduleIdentifier, {
      state: 'evaluated',
      moduleInstance: proxiedModule,
      consumedModules: new Set(),
    });
  }

  async getConsumedModules(
    moduleIdentifier: string,
    consumed = new Set<string>(),
  ): Promise<string[]> {
    if (consumed.has(moduleIdentifier)) {
      return [];
    }
    consumed.add(moduleIdentifier);

    let resolvedModuleIdentifier = new URL(moduleIdentifier);
    let module = this.getModule(resolvedModuleIdentifier.href);

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
          `encountered an error trying to load the module ${moduleIdentifier}. The consumedModule result includes all the known consumed modules including the module that caused the error: ${err.message}`,
        );
      }
    }
    if (module?.state === 'evaluated' || module?.state === 'broken') {
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
    if (urlOrRequest instanceof Request) {
      return urlOrRequest;
    } else {
      return new Request(urlOrRequest, init);
    }
  }

  // For following redirects of responses returned by loader's urlHandlers
  private async simulateFetch(
    request: Request,
    result: Response,
  ): Promise<Response> {
    const urlString = request.url;
    let redirectedHeaderKey = 'simulated-fetch-redirected'; // Temporary header to track if the request was redirected in the redirection chain

    if (result.status >= 300 && result.status < 400) {
      const location = result.headers.get('location');
      if (location) {
        request.headers.set(redirectedHeaderKey, 'true');
        return await this.fetch(new URL(location, urlString), request);
      }
    }

    // We are using Object.defineProperty because `url` and `redirected`
    // response properties are read-only. We are overriding these properties to
    // conform to the Fetch API specification where the `url` property is set to
    // the final URL and the `redirected` property is set to true if the request
    // was redirected. Normally, when using a native fetch, these properties are
    // set automatically by the client, but in this case, we are simulating the
    // fetch and need to set these properties manually.

    if (request.url && !result.url) {
      Object.defineProperty(result, 'url', { value: urlString });

      if (request.headers.get(redirectedHeaderKey) === 'true') {
        Object.defineProperty(result, 'redirected', { value: true });
        request.headers.delete(redirectedHeaderKey);
      }
    }

    return result;
  }

  async fetch(
    urlOrRequest: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    try {
      for (let handler of this.urlHandlers) {
        let request = this.asRequest(urlOrRequest, init);

        let result = await handler(request);
        if (result) {
          return await this.simulateFetch(request, result);
        }
      }

      let shimmedModule = this.moduleShims.get(
        this.asRequest(urlOrRequest, init).url,
      );
      if (shimmedModule) {
        let response = new Response();
        (response as any)[Symbol.for('shimmed-module')] = shimmedModule;
        return response;
      }

      return await this.fetchImplementation(this.asRequest(urlOrRequest, init));
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
  }

  private getModule(moduleIdentifier: string): Module | undefined {
    return this.modules.get(trimModuleIdentifier(moduleIdentifier));
  }

  private setModule(moduleIdentifier: string, module: Module) {
    this.modules.set(trimModuleIdentifier(moduleIdentifier), module);
  }

  private createModuleProxy(module: any, moduleIdentifier: string) {
    let moduleId = trimExecutableExtension(new URL(moduleIdentifier)).href;
    return new Proxy(module, {
      get: (target, property, received) => {
        let value = Reflect.get(target, property, received);
        if (typeof value === 'function' && typeof property === 'string') {
          if (!this.identities.has(value)) {
            this.identities.set(value, {
              module: moduleId,
              name: property,
            });
            Loader.loaders.set(value, this);
          }
        }
        return value;
      },
      set() {
        throw new Error(`modules are read only`);
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
    let moduleInstance = this.createModuleProxy(
      privateModuleInstance,
      moduleIdentifier,
    );
    let consumedModules = new Set(
      flatMap(module.dependencies, (dep) =>
        dep.type === 'dep' ? [dep.moduleURL.href] : [],
      ),
    );

    this.setModule(moduleIdentifier, {
      state: 'preparing',
      implementation: module.implementation,
      moduleInstance,
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
      this.setModule(moduleIdentifier, {
        state: 'evaluated',
        moduleInstance,
        consumedModules,
      });
      return moduleInstance;
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

    if (Symbol.for('shimmed-module') in response) {
      return {
        type: 'shimmed',
        module: (response as any)[Symbol.for('shimmed-module')],
      };
    }

    return { type: 'source', source: await response.text() };
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

async function maybeHandleScopedCSSRequest(req: Request) {
  if (isScopedCSSRequest(req.url)) {
    // isFastBoot doesn’t work here because this runs outside FastBoot but inside Node
    if (typeof (globalThis as any).document == 'undefined') {
      return Promise.resolve(new Response('', { status: 200 }));
    } else {
      let decodedCSS = decodeScopedCSSRequest(req.url);
      return Promise.resolve(
        new Response(`
          let styleNode = document.createElement('style');
          let styleText = document.createTextNode('${jsEscapeString(
            decodedCSS,
          )}');
          styleNode.appendChild(styleText);
          document.head.appendChild(styleNode);
        `),
      );
    }
  } else {
    return Promise.resolve(null);
  }
}
