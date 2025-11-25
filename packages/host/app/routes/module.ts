import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import type Transition from '@ember/routing/transition';
import { service } from '@ember/service';

import { isTesting } from '@embroider/macros';

import { parse } from 'date-fns';

import isEqual from 'lodash/isEqual';

import {
  type Definition,
  type CodeRef,
  type ResolvedCodeRef,
  type ErrorEntry,
  type ModuleDefinitionResult,
  isBaseDef,
  baseCardRef,
  baseRealm,
  Deferred,
  loadCardDef,
  internalKeyFor,
  trimExecutableExtension,
  isCardError,
  isCardDef,
  identifyCard,
  parseRenderRouteOptions,
  SupportedMimeType,
  getFieldDefinitions,
  CardError,
  unixTime,
} from '@cardstack/runtime-common';
import {
  serializableError,
  isCardErrorJSONAPI,
  type SerializedError,
} from '@cardstack/runtime-common/error';

import type { CardDef, BaseDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

import { createAuthErrorGuard } from '../utils/auth-error-guard';
import { ensureMessageIncludesUrl, stripSelfDeps } from '../utils/render-error';
import {
  enableRenderTimerStub,
  beginTimerBlock,
} from '../utils/render-timer-stub';

import type LoaderService from '../services/loader-service';
import type NetworkService from '../services/network';
import type RenderStoreService from '../services/render-store';

export type Model = {
  id: string;
  status: 'ready' | 'error';
  nonce: string;
  isShimmed: boolean;
  lastModified: number;
  createdAt: number;
  deps: string[];
  definitions: {
    [name: string]: ModuleDefinitionResult | ErrorEntry;
  };
  error?: ErrorEntry;
};

interface CardType {
  refURL: string;
  codeRef: CodeRef;
  displayName: string;
}
type TypesWithErrors =
  | {
      type: 'types';
      types: CardType[];
    }
  | {
      type: 'error';
      error: SerializedError;
    };

export default class ModuleRoute extends Route<Model> {
  @service declare router: RouterService;
  @service('render-store') declare store: RenderStoreService;
  @service declare loaderService: LoaderService;
  @service declare private network: NetworkService;

  private typesCache = new WeakMap<typeof BaseDef, Promise<TypesWithErrors>>();
  private lastStoreResetKey: string | undefined;
  #authGuard = createAuthErrorGuard();
  #restoreRenderTimers: (() => void) | undefined;
  #releaseTimerBlock: (() => void) | undefined;

  deactivate() {
    (globalThis as any).__lazilyLoadLinks = undefined;
    (globalThis as any).__boxelRenderContext = undefined;
    this.lastStoreResetKey = undefined;
    this.#authGuard.unregister();
    this.#restoreRenderTimers?.();
    this.#restoreRenderTimers = undefined;
    this.#releaseTimerBlock?.();
    this.#releaseTimerBlock = undefined;
  }

  async beforeModel(transition: Transition) {
    await super.beforeModel?.(transition);
    // activate() doesn't run early enough for this to be set before the model()
    // hook is run
    (globalThis as any).__lazilyLoadLinks = true;
    (globalThis as any).__boxelRenderContext = true;
    this.#authGuard.register();
    if (!isTesting()) {
      await this.store.ensureSetupComplete();
      this.#restoreRenderTimers = enableRenderTimerStub();
      this.#releaseTimerBlock = beginTimerBlock();
    }
  }

  async model({
    id,
    nonce,
    options,
  }: {
    id: string;
    nonce: string;
    options?: string;
  }) {
    let parsedOptions = parseRenderRouteOptions(options);
    // Make it easy for Puppeteer to do regular Ember transitions
    (globalThis as any).boxelTransitionTo = (
      ...args: Parameters<RouterService['transitionTo']>
    ) => {
      this.router.transitionTo(...args);
    };

    if (parsedOptions.clearCache) {
      this.typesCache = new WeakMap();
      this.loaderService.resetLoader({
        clearFetchCache: true,
        reason: 'module-route clearCache',
      });
      let resetKey = `${id}:${nonce}`;
      if (this.lastStoreResetKey !== resetKey) {
        this.store.resetCache();
        this.lastStoreResetKey = resetKey;
      }
    }

    let module: Record<string, any> | undefined;
    try {
      module = await this.#authGuard.race(() =>
        this.loaderService.loader.import(id),
      );
    } catch (err: any) {
      if (this.#authGuard.isAuthError(err)) {
        return modelWithError({
          id,
          nonce,
          message: err.message ?? 'Authorization error logging into realm',
          err,
          status: err.status ?? (isCardError(err) ? err.status : 401),
        });
      }
      console.warn(`encountered error loading module "${id}": ${err.message}`);
      let depsSet = new Set(
        await (
          await this.loaderService.loader.getConsumedModules(id)
        ).filter((u) => u !== id),
      );
      if (isCardError(err) && err.deps) {
        for (let dep of err.deps) {
          depsSet.add(dep);
        }
      }
      return modelWithError({
        id,
        nonce,
        deps: [...depsSet],
        message: `encountered error loading module "${id}": ${err.message}`,
        err,
      });
    }

    let response: Response;
    try {
      response = await this.network.authedFetch(id, {
        method: 'HEAD',
        headers: {
          Accept: SupportedMimeType.CardSource,
        },
      });
    } catch (err: any) {
      console.warn(
        `Encountered error HTTP HEAD (accept: card-source) ${id}: ${err.message}`,
      );
      return modelWithError({
        id,
        nonce,
        message: `Encountered error HTTP HEAD (accept: card-source) ${id}: ${err.message}`,
        err,
      });
    }
    let maybeShimmed = response.status === 404;
    if (!maybeShimmed && !response.ok) {
      return modelWithError({
        id,
        nonce,
        status: response.status,
        message: `Could not HTTP HEAD (accept: card-source) ${id}: ${response.status} - ${response.statusText}`,
      });
    }

    let lastModified: number;
    let createdAt: number;
    let deps: string[];

    let isShimmed = maybeShimmed;
    if (maybeShimmed) {
      // for testing purposes we'll still generate meta for shimmed cards,
      // however the deps will only be the shimmed file
      lastModified = 0;
      createdAt = 0;
      deps = [trimExecutableExtension(new URL(id)).href];
    } else {
      let consumes = (
        await this.loaderService.loader.getConsumedModules(id)
      ).filter((u) => u !== id);
      deps = consumes.map((d) => trimExecutableExtension(new URL(d)).href);
      let lastModifiedRFC7321 = response.headers.get('last-modified');
      let createdAtRFC7321 = response.headers.get('x-created');
      if (!lastModifiedRFC7321) {
        return modelWithError({
          id,
          nonce,
          deps,
          message: `HTTP HEAD (accept: card-source) ${id} has no last-modified time header`,
        });
      }
      lastModified = parseRfc7321Time(lastModifiedRFC7321);
      createdAt = createdAtRFC7321
        ? parseRfc7321Time(createdAtRFC7321)
        : lastModified;
    }

    let definitions: {
      [name: string]: ModuleDefinitionResult | ErrorEntry;
    } = {};
    for (let [name, maybeBaseDef] of Object.entries(module)) {
      if (isBaseDef(maybeBaseDef)) {
        let definition = await this.#makeDefinition({
          name,
          url: trimExecutableExtension(new URL(id)),
          cardOrFieldDef: maybeBaseDef,
        });
        let codeRef = internalKeyFor({ module: id, name }, undefined);
        definitions[codeRef] = definition;
      }
    }

    return {
      id,
      nonce,
      status: 'ready' as const,
      deps,
      lastModified,
      createdAt,
      isShimmed,
      definitions,
    };
  }

  async #makeDefinition({
    url,
    name,
    cardOrFieldDef,
  }: {
    url: URL;
    name: string;
    cardOrFieldDef: typeof BaseDef;
  }): Promise<ModuleDefinitionResult | ErrorEntry> {
    try {
      let api = await this.loaderService.loader.import<typeof CardAPI>(
        `${baseRealm.url}card-api`,
      );
      let fields = getFieldDefinitions(api, cardOrFieldDef);
      let codeRef = identifyCard(cardOrFieldDef) as ResolvedCodeRef;
      let definition: Definition = {
        codeRef,
        fields,
        type: isCardDef(cardOrFieldDef) ? 'card-def' : 'field-def',
        displayName: isCardDef(cardOrFieldDef)
          ? cardOrFieldDef.displayName
          : null,
      };
      let typesMaybeError = isCardDef(cardOrFieldDef)
        ? await this.#getTypes(cardOrFieldDef)
        : { type: 'types' as const, types: [] };
      if (typesMaybeError.type === 'error') {
        console.warn(
          `encountered error indexing definition  "${url.href}/${name}": ${typesMaybeError.error.message}`,
        );
        return {
          type: 'error',
          error:
            typesMaybeError.error.status == null
              ? { ...typesMaybeError.error, status: 500 }
              : typesMaybeError.error,
        } as ErrorEntry;
      }
      return {
        type: 'definition',
        definition,
        moduleURL: trimExecutableExtension(new URL(url)).href,
        types: typesMaybeError.types.map(({ refURL }) => refURL),
      };
    } catch (err: any) {
      console.warn(
        `encountered error indexing definition "${url.href}/${name}": ${err.message}`,
      );
      return {
        type: 'error',
        error: toSerializedError(
          err,
          `encountered error indexing definition "${url.href}/${name}": ${describeError(err)}`,
        ),
      } as ErrorEntry;
    }
  }

  async #getTypes(card: typeof CardDef): Promise<TypesWithErrors> {
    let cached = this.typesCache.get(card);
    if (cached) {
      return await cached;
    }
    let ref = identifyCard(card);
    if (!ref) {
      throw new Error(`could not identify card ${card.name}`);
    }
    let deferred = new Deferred<TypesWithErrors>();
    this.typesCache.set(card, deferred.promise);
    let types: CardType[] = [];
    let fullRef: CodeRef = ref;
    let result: TypesWithErrors | undefined;
    try {
      for (;;) {
        let loadedCard: typeof CardAPI.CardDef,
          loadedCardRef: CodeRef | undefined;
        try {
          let maybeCard = await loadCardDef(fullRef, {
            loader: this.loaderService.loader,
          });
          if (!isCardDef(maybeCard)) {
            result = {
              type: 'error' as const,
              error: toSerializedError(
                undefined,
                `The definition at ${JSON.stringify(fullRef)} is not a CardDef`,
              ),
            };
            return result;
          }
          loadedCard = maybeCard;
          loadedCardRef = identifyCard(loadedCard);
          if (!loadedCardRef) {
            result = {
              type: 'error' as const,
              error: toSerializedError(
                undefined,
                `could not identify card ${loadedCard.name}`,
              ),
            };
            return result;
          }
        } catch (error) {
          result = {
            type: 'error' as const,
            error: isCardError(error)
              ? serializableError(error)
              : toSerializedError(
                  error,
                  `encountered error loading card type ${JSON.stringify(
                    fullRef,
                  )}`,
                ),
          };
          return result;
        }

        types.push({
          refURL: internalKeyFor(loadedCardRef, undefined),
          codeRef: loadedCardRef,
          displayName: getDisplayName(loadedCard),
        });
        if (!isEqual(loadedCardRef, baseCardRef)) {
          fullRef = {
            type: 'ancestorOf',
            card: loadedCardRef,
          };
        } else {
          break;
        }
      }
      result = { type: 'types', types };
      return result;
    } finally {
      if (result) {
        deferred.fulfill(result);
      } else {
        deferred.fulfill({
          type: 'error',
          error: serializableError(
            new Error(`unable to determine result for card type ${card.name}`),
          ),
        });
      }
    }
  }
}

export function modelWithError({
  id,
  nonce,
  message,
  err,
  status,
  deps = [],
}: {
  id: string;
  nonce: string;
  message: string;
  err?: any;
  deps?: string[];
  status?: number;
}): Model {
  let baseError: SerializedError;
  let maybeCardError: CardError | undefined;
  if (err instanceof CardError) {
    maybeCardError = err;
  } else if (isCardErrorJSONAPI(err) && err.status === 406) {
    maybeCardError = CardError.fromCardErrorJsonAPI(err, err.id, err.status);
  }

  if (maybeCardError && maybeCardError.status === 406) {
    let hoisted = CardError.fromSerializableError(
      serializableError(maybeCardError),
    );
    let depsSet = new Set([...(hoisted.deps ?? []), ...deps]);
    hoisted.deps = stripSelfDeps(
      depsSet.size ? [...depsSet] : undefined,
      id,
      id,
    );
    hoisted.message = ensureMessageIncludesUrl(hoisted.message, id);
    hoisted.additionalErrors = null;
    baseError = serializableError(hoisted);
  } else {
    baseError = {
      status: status ?? err?.status ?? 500,
      message,
      additionalErrors: err !== undefined ? [serializableError(err)] : null,
      deps: stripSelfDeps(deps, id, id),
    };
  }
  return {
    id,
    nonce,
    status: 'error' as const,
    deps: deps,
    isShimmed: false,
    lastModified: 0,
    createdAt: 0,
    definitions: {},
    error: {
      type: 'error',
      error: baseError,
    },
  };
}

function toSerializedError(err: unknown, message: string): SerializedError {
  let status = 500;
  let deps: string[] | undefined;
  let title: string | undefined;
  if (isCardError(err)) {
    status = err.status ?? status;
    deps = err.deps;
    title = err.title ?? title;
  } else if (
    err &&
    typeof err === 'object' &&
    typeof (err as any).status === 'number'
  ) {
    status = (err as any).status;
    if (Array.isArray((err as any).deps)) {
      deps = (err as any).deps;
    }
    if (typeof (err as any).title === 'string') {
      title = (err as any).title;
    }
  }
  let cardError = new CardError(message, {
    status,
    ...(title ? { title } : {}),
  });
  if (deps) {
    cardError.deps = deps;
  }
  if (err instanceof Error && err.stack) {
    cardError.stack = err.stack;
  }
  let additional = err != null ? serializableError(err) : undefined;
  if (additional != null) {
    cardError.additionalErrors = [additional];
  } else {
    cardError.additionalErrors = null;
  }
  return serializableError(cardError);
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function parseRfc7321Time(time: string) {
  return unixTime(
    parse(
      time.replace(/ GMT$/, 'Z'),
      'EEE, dd MMM yyyy HH:mm:ssX',
      new Date(),
    ).getTime(),
  );
}

function getDisplayName(card: typeof CardDef) {
  if (card.displayName === 'Card') {
    return card.name;
  } else {
    return card.displayName;
  }
}
