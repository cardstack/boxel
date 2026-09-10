import { registerDestructor } from '@ember/destroyable';
import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import type Transition from '@ember/routing/transition';
import { service } from '@ember/service';

import { isTesting } from '@embroider/macros';

import { parse } from 'date-fns';

import { isEqual } from 'lodash-es';

import {
  baseCardRef,
  CardError,
  Deferred,
  definitionDisplayName,
  definitionKind,
  getFieldDefinitions,
  identifyCard,
  internalKeyFor,
  isBaseDef,
  isCardDef,
  isCardError,
  loadCardDef,
  parseRenderRouteOptions,
  rri,
  SupportedMimeType,
  trimExecutableExtension,
  type CodeRef,
  type Definition,
  type ErrorEntry,
  type ModuleDefinitionResult,
  type OperationLoweringDiagnostic,
  type OperationLoweringIssue,
  type PrerenderResponseMeta,
  type RealmResourceIdentifier,
  type RenderRouteOptions,
  type ResolvedCodeRef,
  type SearchablePathDiagnostic,
  unixTime,
  validateSearchablePaths,
} from '@cardstack/runtime-common';
// Imported from its own entry rather than the barrel: the pass reaches
// `@cardstack/bxl`, and the barrel deliberately carries only the lowered
// shapes so no other package type-checks bxl's sources.
import { lowerOperationDeclarations } from '@cardstack/runtime-common/card-operations';
import {
  serializableError,
  isCardErrorJSONAPI,
  type SerializedError,
} from '@cardstack/runtime-common/error';

import { createAuthErrorGuard } from '../utils/auth-error-guard';
import { registerBoxelTransitionTo } from '../utils/register-boxel-transition';
import { ensureMessageIncludesUrl, stripSelfDeps } from '../utils/render-error';
import {
  enableRenderTimerStub,
  beginTimerBlock,
} from '../utils/render-timer-stub';

import type LoaderService from '../services/loader-service';
import type NetworkService from '../services/network';
import type RealmService from '../services/realm';
import type RenderStoreService from '../services/render-store';
import type * as CardAPI from '@cardstack/base/card-api';
import type { CardDef, BaseDef } from '@cardstack/base/card-api';
import type * as OperationsAPI from '@cardstack/base/operations';

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
  // All export names of the module — `definitions` only covers BaseDef
  // exports, so this is the only signal for validating non-card exports
  // (e.g. skill command classes). Absent on error models.
  exports?: string[];
  error?: ErrorEntry;
  // Definition-build diagnostics (currently the `searchable`-path validation
  // findings) ride here so they JSON-round-trip into the `ModuleRenderResponse`
  // and persist to `modules.diagnostics` via `flattenPrerenderMeta`. Absent
  // when there's nothing to report.
  meta?: PrerenderResponseMeta;
};

interface CardType {
  refURL: string;
  codeRef: CodeRef;
  displayName: string;
}
export type TypesWithErrors =
  | {
      type: 'types';
      types: CardType[];
    }
  | {
      type: 'error';
      error: SerializedError;
    };
export type ModuleTypesCache = WeakMap<
  typeof BaseDef,
  Promise<TypesWithErrors>
>;
export interface ModuleModelState {
  getTypesCache(): ModuleTypesCache;
  setTypesCache(cache: ModuleTypesCache): void;
  getLastStoreResetKey(): string | undefined;
  setLastStoreResetKey(key: string | undefined): void;
}
export interface ModuleModelContext {
  router: RouterService;
  store: RenderStoreService;
  loaderService: LoaderService;
  network: NetworkService;
  authGuard: ReturnType<typeof createAuthErrorGuard>;
  state: ModuleModelState;
  owner: object;
}
export interface ModuleModelParams {
  id: string;
  nonce: string;
  renderOptions?: RenderRouteOptions;
}

export default class ModuleRoute extends Route<Model> {
  @service declare router: RouterService;
  @service('render-store') declare store: RenderStoreService;
  @service declare loaderService: LoaderService;
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;

  private typesCache: ModuleTypesCache = new WeakMap<
    typeof BaseDef,
    Promise<TypesWithErrors>
  >();
  private lastStoreResetKey: string | undefined;
  #authGuard = createAuthErrorGuard();
  #restoreRenderTimers: (() => void) | undefined;
  #releaseTimerBlock: (() => void) | undefined;

  deactivate() {
    if (isTesting()) {
      (globalThis as any).__boxelRenderContext = undefined;
    }
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
    (globalThis as any).__boxelRenderContext = true;
    registerDestructor(this, () => {
      if (isTesting()) {
        (globalThis as any).__boxelRenderContext = undefined;
      }
    });
    this.#authGuard.register();
    if (!isTesting()) {
      await this.store.ensureSetupComplete();
      this.realm.restoreSessionsFromStorage();
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
    this.#synchronizeLoaderEpoch(parsedOptions.loaderEpoch);
    return await buildModuleModel(
      {
        id,
        nonce,
        renderOptions: parsedOptions,
      },
      this.#moduleModelContext(),
    );
  }

  // Loader-epoch synchronization, this route's half of what routes/render.ts
  // does for visits: the realm's loader epoch is re-minted whenever its
  // executable modules change (an index pass that invalidates one, or the
  // write that changed the bytes), and a mismatch in either direction means
  // this tab's loader belongs to a different module timeline. Without it a
  // module render imports out of whatever this tab already evaluated, so a
  // module rewritten since then reports its previous shape — with the current
  // file metadata attached, since that is re-read per render — and the
  // definition cache stores that under the rewritten module's URL.
  //
  // On the route rather than in `buildModuleModel`, which the route shares
  // with card-prerender.gts. That component mounts only under `isTesting()`,
  // so its renders run inside the test harness's own tab, sharing the loader
  // and store with the application under test — state the harness and the
  // app's own file resources and realm subscriptions already keep current.
  // Replacing it from here would discard live state on a schedule neither
  // has a part in. A tab that reached this route exists to serve renders and
  // holds nothing else worth keeping.
  //
  // Held under its own key rather than the one routes/render.ts uses. Visits
  // thread the epoch their indexing batch minted, which is not committed
  // until the batch ends, while this route's callers read the committed
  // column; a single key would read that lag as two timelines alternating and
  // reset the loader on every render for the length of the batch. Separate
  // keys cost a tab one extra reset per epoch — each series synchronizes
  // independently — and a reset only ever leaves the loader fresher than the
  // other series assumes.
  #synchronizeLoaderEpoch(loaderEpoch: string | undefined) {
    if (loaderEpoch === undefined) {
      return;
    }
    let held = (globalThis as any).__boxelModuleLoaderEpoch as
      | string
      | undefined;
    if (held === loaderEpoch) {
      return;
    }
    this.typesCache = new WeakMap<typeof BaseDef, Promise<TypesWithErrors>>();
    this.loaderService.resetLoader({
      clearFetchCache: true,
      reason: 'module-route loader epoch changed',
    });
    this.store.resetCache();
    (globalThis as any).__boxelModuleLoaderEpoch = loaderEpoch;
  }

  #moduleModelContext(): ModuleModelContext {
    return {
      router: this.router,
      store: this.store,
      loaderService: this.loaderService,
      network: this.network,
      authGuard: this.#authGuard,
      state: {
        getTypesCache: () => this.typesCache,
        setTypesCache: (cache) => (this.typesCache = cache),
        getLastStoreResetKey: () => this.lastStoreResetKey,
        setLastStoreResetKey: (key) => {
          this.lastStoreResetKey = key;
        },
      },
      owner: this,
    };
  }
}

export async function buildModuleModel(
  { id, nonce, renderOptions }: ModuleModelParams,
  context: ModuleModelContext,
): Promise<Model> {
  let parsedOptions = renderOptions ?? {};
  let moduleURL = trimExecutableExtension(rri(id));
  registerBoxelTransitionTo(context.router, context.owner);

  if (parsedOptions.clearCache) {
    context.state.setTypesCache(
      new WeakMap<typeof BaseDef, Promise<TypesWithErrors>>(),
    );
    context.loaderService.resetLoader({
      clearFetchCache: true,
      reason: 'module-route clearCache',
    });
    let resetKey = `${id}:${nonce}`;
    if (context.state.getLastStoreResetKey() !== resetKey) {
      context.store.resetCache();
      context.state.setLastStoreResetKey(resetKey);
    }
  }

  try {
    return await context.authGuard.race(async () => {
      let module: Record<string, any> | undefined;
      try {
        module = await context.loaderService.loader.import(id);
      } catch (err: any) {
        console.warn(
          `encountered error loading module "${id}": ${err.message}`,
        );
        let depsSet = new Set(
          await (
            await context.loaderService.loader.getConsumedModules(id)
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
        response = await context.network.authedFetch(id, {
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
        deps = [moduleURL];
      } else {
        let consumes = (
          await context.loaderService.loader.getConsumedModules(id)
        ).filter((u) => u !== id);
        deps = consumes.map((d) => trimExecutableExtension(rri(d)));
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
      let operationIssues: OperationLoweringDiagnostic[] = [];
      for (let [name, maybeBaseDef] of Object.entries(module)) {
        if (isBaseDef(maybeBaseDef)) {
          let found: OperationLoweringIssue[] = [];
          let definition = await makeDefinition(
            {
              name,
              url: moduleURL,
              cardOrFieldDef: maybeBaseDef,
            },
            context,
            found,
          );
          let codeRef = internalKeyFor(
            { module: id as RealmResourceIdentifier, name },
            undefined,
            context.network.virtualNetwork,
          );
          definitions[codeRef] = definition;
          for (let issue of found) {
            operationIssues.push({ codeRef, ...issue });
          }
        }
      }

      let searchablePathIssues = await validateModuleSearchablePaths(
        definitions,
        context,
      );
      // Both definition-build passes report through the same channel, and
      // each contributes its key only when it found something — a module with
      // nothing to report carries no `meta` at all.
      let diagnostics = {
        ...(searchablePathIssues.length > 0 ? { searchablePathIssues } : {}),
        ...(operationIssues.length > 0 ? { operationIssues } : {}),
      };

      return {
        id,
        nonce,
        status: 'ready' as const,
        deps,
        lastModified,
        createdAt,
        isShimmed,
        definitions,
        exports: Object.keys(module),
        ...(Object.keys(diagnostics).length > 0
          ? { meta: { diagnostics } }
          : {}),
      };
    });
  } catch (err: any) {
    if (context.authGuard.isAuthError(err)) {
      return modelWithError({
        id,
        nonce,
        message: err.message ?? 'Authorization error logging into realm',
        err,
        status: err.status ?? (isCardError(err) ? err.status : 401),
      });
    }
    throw err;
  }
}

// Validate the `searchable` annotations on every definition this module built,
// resolving each dotted path against the definition graph. Findings are
// recorded (never thrown) onto `meta.diagnostics` so an un-routable path
// surfaces in `modules.diagnostics` rather than silently making nothing
// searchable. Inert until a field actually declares `searchable`: when no
// built definition carries one we return before importing card-api or touching
// the loader at all. The whole pass is best-effort — any failure is logged and
// yields no findings rather than breaking the definition build.
async function validateModuleSearchablePaths(
  definitions: { [name: string]: ModuleDefinitionResult | ErrorEntry },
  context: ModuleModelContext,
): Promise<SearchablePathDiagnostic[]> {
  let issues: SearchablePathDiagnostic[] = [];
  let hasAnnotation = Object.values(definitions).some(
    (entry) =>
      entry.type === 'definition' &&
      Object.values(entry.definition.fieldDefs).some(
        (fieldDef) => fieldDef.searchable != null,
      ),
  );
  if (!hasAnnotation) {
    return issues;
  }
  try {
    let loader = context.loaderService.loader;
    let api = await loader.import<typeof CardAPI>('@cardstack/base/card-api');
    let lookupDefinition = makeDefinitionLookup(
      api,
      loader,
      'searchable validation',
    );
    for (let [codeRef, entry] of Object.entries(definitions)) {
      if (entry.type !== 'definition') {
        continue;
      }
      let found = await validateSearchablePaths(
        entry.definition,
        lookupDefinition,
      );
      for (let { fieldName, path } of found) {
        console.warn(
          `searchable validation: unresolvable path "${path}" on field "${fieldName}" of ${codeRef}`,
        );
        issues.push({ codeRef, fieldName, path });
      }
    }
  } catch (err: any) {
    console.warn(`searchable validation: unexpected failure: ${err.message}`);
  }
  return issues;
}

// Resolve a CodeRef to its `Definition` through the loader — what
// `CachingDefinitionLookup` does loaderlessly on the realm server, in the one
// process that has the classes in hand. Definition build reaches for this
// whenever a check has to look past the definition it is holding: a dotted
// field path's next segment, or the type a `create` declares it mints. An
// unloadable ref resolves to undefined, which makes every path under it
// unresolvable — recorded by the caller, never raised, since a definition
// build that fails over one unreachable dependency reports nothing at all.
function makeDefinitionLookup(
  api: typeof CardAPI,
  loader: ModuleModelContext['loaderService']['loader'],
  label: string,
): (codeRef: CodeRef) => Promise<Definition | undefined> {
  return async (codeRef: CodeRef) => {
    try {
      let card = await loadCardDef(codeRef, { loader });
      let { fields, fieldDefs } = getFieldDefinitions(api, card);
      return {
        codeRef,
        fields,
        fieldDefs,
        type: definitionKind(card),
        displayName: definitionDisplayName(card),
      };
    } catch (err: any) {
      console.warn(
        `${label}: could not resolve definition ${JSON.stringify(codeRef)}: ${
          err.message
        }`,
      );
      return undefined;
    }
  };
}

// Capture a def's `@operation` declarations into its definition entry,
// lowered to the base-operation data plus BXL the realm executes. This is
// what makes an operation reachable from a card's `adoptsFrom`: the type's
// entry carries the whole operation, so the realm runs it without loading the
// card's module.
//
// A def that declares nothing yields undefined and its entry is unchanged, so
// the definition JSON for every existing card is byte-identical. Lowering
// records its findings rather than throwing, and they land on the module's
// diagnostics next to the `searchable`-path findings; an operation with
// findings is still stored, flagged `invalid`, so invoking it says what is
// wrong with the declaration. The whole pass is best-effort in the same way
// the `searchable` pass is — a failure is logged and captures no operations
// rather than failing the definition.
async function captureOperations(
  cardOrFieldDef: typeof BaseDef,
  definition: Definition,
  api: typeof CardAPI,
  context: ModuleModelContext,
  issues: OperationLoweringIssue[],
): Promise<Definition['operations'] | undefined> {
  try {
    let loader = context.loaderService.loader;
    let operationsApi = await loader.import<typeof OperationsAPI>(
      '@cardstack/base/operations',
    );
    // The authored view, not `getOperations`: a base operation reached with no
    // declaration has nothing to lower, and the clause a base requires is
    // only guaranteed present on an entry that went through the decorator.
    let declared = operationsApi.getDeclaredOperations(cardOrFieldDef);
    if (Object.keys(declared).length === 0) {
      return undefined;
    }
    let lowered = await lowerOperationDeclarations(declared, {
      definition,
      lookupDefinition: makeDefinitionLookup(api, loader, 'operation lowering'),
      identifyCard: (def) => identifyCard(def),
    });
    for (let issue of lowered.issues) {
      console.warn(
        `operation lowering: ${issue.operation} (${issue.code} at ${issue.path}): ${issue.message}`,
      );
    }
    issues.push(...lowered.issues);
    return lowered.operations;
  } catch (err: any) {
    console.warn(`operation lowering: unexpected failure: ${err.message}`);
    return undefined;
  }
}

async function makeDefinition(
  {
    url,
    name,
    cardOrFieldDef,
  }: {
    url: RealmResourceIdentifier | URL;
    name: string;
    cardOrFieldDef: typeof BaseDef;
  },
  context: ModuleModelContext,
  // Collects the operation-lowering findings for this def. The caller tags
  // each with the def it came from, which is the only place the def's
  // internal key is already computed.
  operationIssues: OperationLoweringIssue[],
): Promise<ModuleDefinitionResult | ErrorEntry> {
  let urlString = url instanceof URL ? url.href : url;
  try {
    let api = await context.loaderService.loader.import<typeof CardAPI>(
      '@cardstack/base/card-api',
    );
    let { fields, fieldDefs } = getFieldDefinitions(api, cardOrFieldDef);
    let codeRef = identifyCard(cardOrFieldDef) as ResolvedCodeRef;
    let definition: Definition = {
      codeRef,
      fields,
      fieldDefs,
      type: definitionKind(cardOrFieldDef),
      displayName: definitionDisplayName(cardOrFieldDef),
    };
    let operations = await captureOperations(
      cardOrFieldDef,
      definition,
      api,
      context,
      operationIssues,
    );
    if (operations) {
      definition.operations = operations;
    }
    let typesMaybeError = isCardDef(cardOrFieldDef)
      ? await getTypes(cardOrFieldDef, context)
      : { type: 'types' as const, types: [] };
    if (typesMaybeError.type === 'error') {
      console.warn(
        `encountered error indexing definition  "${urlString}/${name}": ${typesMaybeError.error.message}`,
      );
      return {
        type: 'module-error',
        error:
          typesMaybeError.error.status == null
            ? { ...typesMaybeError.error, status: 500 }
            : typesMaybeError.error,
      } as ErrorEntry;
    }
    return {
      type: 'definition',
      definition,
      moduleURL: trimExecutableExtension(rri(urlString)),
      types: typesMaybeError.types.map(({ refURL }) => refURL),
    };
  } catch (err: any) {
    console.warn(
      `encountered error indexing definition "${urlString}/${name}": ${err.message}`,
    );
    return {
      type: 'module-error',
      error: toSerializedError(
        err,
        `encountered error indexing definition "${urlString}/${name}": ${describeError(err)}`,
      ),
    } as ErrorEntry;
  }
}

async function getTypes(
  card: typeof CardDef,
  context: ModuleModelContext,
): Promise<TypesWithErrors> {
  let cache = context.state.getTypesCache();
  let cached = cache.get(card);
  if (cached) {
    return await cached;
  }
  let ref = identifyCard(card);
  if (!ref) {
    throw new Error(`could not identify card ${card.name}`);
  }
  let deferred = new Deferred<TypesWithErrors>();
  cache.set(card, deferred.promise);
  let types: CardType[] = [];
  let fullRef: CodeRef = ref;
  let result: TypesWithErrors | undefined;
  try {
    for (;;) {
      let loadedCard: typeof CardAPI.CardDef,
        loadedCardRef: CodeRef | undefined;
      try {
        let maybeCard = await loadCardDef(fullRef, {
          loader: context.loaderService.loader,
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
                `encountered error loading card type ${JSON.stringify(fullRef)}`,
              ),
        };
        return result;
      }

      types.push({
        refURL: internalKeyFor(
          loadedCardRef,
          undefined,
          context.network.virtualNetwork,
        ),
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
    let additional = err !== undefined ? serializableError(err) : null;
    let nestedStatus: number | undefined;
    if (additional) {
      if (typeof additional.status === 'number') {
        nestedStatus = additional.status;
      } else if (
        typeof additional.status === 'string' &&
        /^\d+$/.test(additional.status)
      ) {
        nestedStatus = Number(additional.status);
      }
    }
    baseError = {
      status: status ?? err?.status ?? 500,
      message,
      additionalErrors: additional ? [additional] : null,
      deps: stripSelfDeps(deps, id, id),
    };
    if (nestedStatus && !status && !err?.status) {
      baseError.status = nestedStatus;
    }
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
      type: 'module-error',
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
