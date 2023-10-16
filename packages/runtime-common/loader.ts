import TransformModulesAmdPlugin from 'transform-modules-amd-plugin';
import { transformSync } from '@babel/core';
import { Deferred } from './deferred';
import { trimExecutableExtension, logger } from './index';
import { RealmPaths } from './paths';
import { CardError } from './error';
import flatMap from 'lodash/flatMap';
import { type RunnerOpts } from './search-index';
import { decodeScopedCSSRequest, isScopedCSSRequest } from 'glimmer-scoped-css';
import jsEscapeString from 'js-string-escape';

const isFastBoot = typeof (globalThis as any).FastBoot !== 'undefined';

// this represents a URL that has already been resolved to aid in documenting
// when resolution has already been performed
export interface ResolvedURL extends URL {
  _isResolved: undefined;
}

function isResolvedURL(url: URL | ResolvedURL): url is ResolvedURL {
  return '_isResolved' in url;
}

export function makeResolvedURL(unresolvedURL: URL | string): ResolvedURL {
  let resolvedURL = new URL(unresolvedURL) as ResolvedURL;
  resolvedURL._isResolved = undefined;
  return resolvedURL;
}

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
  | { type: 'dep'; moduleURL: ResolvedURL }
  | { type: 'shim-dep'; moduleId: string }
  | { type: '__import_meta__' }
  | { type: 'exports' };

type EvaluatableDep =
  | {
      type: 'dep';
      moduleURL: ResolvedURL;
    }
  | {
      type: 'completing-dep';
      moduleURL: ResolvedURL;
    }
  | {
      type: 'shim-dep';
      moduleId: string;
    }
  | { type: '__import_meta__' }
  | { type: 'exports' };

export type RequestHandler = (req: Request) => Promise<Response | null>;

export class Loader {
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

  static cloneLoader(loader: Loader): Loader {
    let clone = new Loader();
    clone.urlHandlers = loader.urlHandlers;
    clone.urlMappings = loader.urlMappings;
    for (let [moduleIdentifier, module] of loader.moduleShims) {
      clone.shimModule(moduleIdentifier, module);
    }
    return clone;
  }

  addURLMapping(from: URL, to: URL) {
    this.urlMappings.push([from.href, to.href]);
  }

  registerURLHandler(handler: RequestHandler) {
    this.urlHandlers.push(handler);
  }

  prependURLHandlers(handlers: RequestHandler[]) {
    this.urlHandlers = [...handlers, ...this.urlHandlers];
  }

  shimModule(moduleIdentifier: string, module: Record<string, any>) {
    this.moduleShims.set(
      moduleIdentifier,
      this.createModuleProxy(module, moduleIdentifier),
    );
    this.setModule(moduleIdentifier, {
      state: 'evaluated',
      moduleInstance: module,
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
    let resolvedModule = this.resolve(moduleIdentifier);
    let resolvedModuleIdentifier = resolvedModule.href;
    let shimmed = this.moduleShims.get(moduleIdentifier);
    if (shimmed) {
      return shimmed as T;
    }
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
    resolvedURL: ResolvedURL,
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
            let depModule = this.getModule(
              entry.type === 'dep' ? entry.moduleURL.href : entry.moduleId,
            );
            if (entry.type === 'shim-dep') {
              maybeReadyDeps.push({
                type: 'shim-dep',
                moduleId: entry.moduleId,
              });
              continue;
            }
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
            let depModuleId =
              entry.type === 'dep' || entry.type === 'completing-dep'
                ? entry.moduleURL.href
                : entry.moduleId;
            let depModule = this.getModule(depModuleId);
            if (entry.type === 'shim-dep') {
              readyDeps.push({
                type: 'shim-dep',
                moduleId: entry.moduleId,
              });
              continue;
            }
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

  private asUnresolvedRequest(
    urlOrRequest: string | URL | Request,
    init?: RequestInit,
  ): Request {
    if (urlOrRequest instanceof Request) {
      return urlOrRequest;
    } else {
      let unresolvedURL =
        typeof urlOrRequest === 'string'
          ? new URL(urlOrRequest)
          : isResolvedURL(urlOrRequest)
          ? this.reverseResolution(urlOrRequest)
          : urlOrRequest;
      return new Request(unresolvedURL.href, init);
    }
  }

  private asResolvedRequest(
    urlOrRequest: string | URL | Request,
    init?: RequestInit,
  ): Request {
    if (urlOrRequest instanceof Request) {
      return new Request(this.resolve(urlOrRequest.url).href, {
        method: urlOrRequest.method,
        headers: urlOrRequest.headers,
        body: urlOrRequest.body,
      });
    } else if (typeof urlOrRequest === 'string') {
      return new Request(this.resolve(urlOrRequest), init);
    } else if (isResolvedURL(urlOrRequest)) {
      return new Request(urlOrRequest, init);
    } else {
      return new Request(this.resolve(urlOrRequest), init);
    }
  }

  async fetch(
    urlOrRequest: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    try {
      for (let handler of this.urlHandlers) {
        let result = await handler(
          this.asUnresolvedRequest(urlOrRequest, init),
        );
        if (result) {
          return result;
        }
      }
      return await getNativeFetch()(this.asResolvedRequest(urlOrRequest, init));
    } catch (err: any) {
      this.log.error(`fetch failed for ${urlOrRequest}`, err);
      return new Response(new Blob(), {
        status: 500,
        statusText: err.message,
      });
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
            toPath.directoryURL(sourcePath.local(absoluteURL)),
          );
        } else {
          return makeResolvedURL(
            toPath.fileURL(
              sourcePath.local(absoluteURL, { preserveQuerystring: true }),
            ),
          );
        }
      }
    }
    return makeResolvedURL(absoluteURL);
  }

  reverseResolution(
    moduleIdentifier: string | ResolvedURL,
    relativeTo?: URL,
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
            destinationPath.local(absoluteURL, { preserveQuerystring: true }),
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
          if (!this.identities.has(value)) {
            this.identities.set(value, {
              module: isUrlLike(moduleIdentifier)
                ? trimExecutableExtension(
                    this.reverseResolution(moduleIdentifier),
                  ).href
                : moduleIdentifier,
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

  private async fetchModule(moduleURL: ResolvedURL): Promise<void> {
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
        } else if (isUrlLike(depId)) {
          return {
            type: 'dep',
            moduleURL: this.resolve(depId, new URL(moduleIdentifier)),
          };
        } else {
          return { type: 'shim-dep', moduleId: depId }; // for npm imports
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
        dep.type === 'dep'
          ? [dep.moduleURL.href]
          : dep.type === 'shim-dep'
          ? [dep.moduleId]
          : [],
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
          case 'shim-dep': {
            let shimModule = this.getModule(entry.moduleId);
            if (shimModule?.state !== 'evaluated') {
              throw new Error(
                `bug: shimmed modules should always be in an 'evaluated' state, but ${entry.moduleId} was in '${module.state}' state`,
              );
            }
            return shimModule.moduleInstance;
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
      optsId: number,
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
