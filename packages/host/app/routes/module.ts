import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';

import { parse } from 'date-fns';

import isEqual from 'lodash/isEqual';

import {
  type Definition,
  type CodeRef,
  type ResolvedCodeRef,
  type ErrorEntry,
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
  type SerializedError,
} from '@cardstack/runtime-common/error';

import type { CardDef, BaseDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

import type LoaderService from '../services/loader-service';
import type NetworkService from '../services/network';
import type StoreService from '../services/store';

interface DefinitionResult {
  type: 'definition';
  definition: Definition;
  types: string[];
}

export type Model = {
  id: string;
  status: 'ready' | 'error';
  nonce: string;
  isShimmed: boolean;
  lastModified: number;
  createdAt: number;
  deps: string[];
  definitions: {
    [name: string]: DefinitionResult | ErrorEntry;
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
  @service declare store: StoreService;
  @service declare loaderService: LoaderService;
  @service declare private network: NetworkService;

  private typesCache = new WeakMap<typeof BaseDef, Promise<TypesWithErrors>>();
  private lastStoreResetKey: string | undefined;

  deactivate() {
    (globalThis as any).__lazilyLoadLinks = undefined;
    (globalThis as any).__boxelRenderContext = undefined;
    this.lastStoreResetKey = undefined;
  }

  beforeModel() {
    // activate() doesn't run early enough for this to be set before the model()
    // hook is run
    (globalThis as any).__lazilyLoadLinks = true;
    (globalThis as any).__boxelRenderContext = true;
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
      module = await this.loaderService.loader.import(id);
    } catch (err: any) {
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
      [name: string]: DefinitionResult | ErrorEntry;
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
  }): Promise<DefinitionResult | ErrorEntry> {
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
      while (fullRef) {
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

function modelWithError({
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
      error: {
        status: status ?? err?.status ?? 500,
        message,
        additionalErrors: err !== undefined ? [serializableError(err)] : null,
        ...(deps ? { deps } : {}),
      },
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
