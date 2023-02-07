import {
  Loader,
  baseRealm,
  baseCardRef,
  LooseCardResource,
  isCardResource,
  isNotLoadedError,
  internalKeyFor,
  trimExecutableExtension,
  hasExecutableExtension,
  maxLinkDepth,
  type NotLoaded,
  type CardRef,
} from '@cardstack/runtime-common';
import {
  loadCard,
  identifyCard,
  isCard,
  moduleFrom,
} from '@cardstack/runtime-common/card-ref';
import { RealmPaths, LocalPath } from '@cardstack/runtime-common/paths';
// TODO make sure to remove this from @cardstack/runtime-common deps
import ignore, { Ignore } from 'ignore';
import isEqual from 'lodash/isEqual';
import { Deferred } from '@cardstack/runtime-common/deferred';
import flatMap from 'lodash/flatMap';
import merge from 'lodash/merge';
import {
  CardError,
  isCardError,
  serializableError,
  type SerializedError,
} from '@cardstack/runtime-common/error';
import {
  type SingleCardDocument,
  type Relationship,
} from '@cardstack/runtime-common/card-document';
import {
  loadLinks,
  isIgnored,
  type Reader,
  type EntrySetter,
  type RunState,
  type Stats,
  type Module,
  type SearchEntryWithErrors,
  type ModuleWithErrors,
} from '@cardstack/runtime-common/search-index';
import { URLMap } from '@cardstack/runtime-common/url-map';
import {
  Card,
  type IdentityContext as IdentityContextType,
} from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type { LoaderType } from 'https://cardstack.com/base/card-api';

type TypesWithErrors =
  | { type: 'types'; types: string[] }
  | { type: 'error'; error: SerializedError };

export class CurrentRun {
  #instances: URLMap<SearchEntryWithErrors>;
  #modules = new Map<string, ModuleWithErrors>();
  #moduleWorkingCache = new Map<string, Promise<Module>>();
  #typesCache = new WeakMap<typeof Card, Promise<TypesWithErrors>>();
  #indexingInstances = new Map<string, Promise<void>>();
  #reader: Reader;
  #realmPaths: RealmPaths;
  #ignoreMap: URLMap<Ignore>;
  #loader: Loader;
  #entrySetter: EntrySetter;
  #staticResponses = new Map<string, string>();
  #renderCard: (
    url: URL,
    staticResponses: Map<string, string>
  ) => Promise<string>;
  #realmURL: URL;
  readonly stats: Stats = {
    instancesIndexed: 0,
    instanceErrors: 0,
    moduleErrors: 0,
  };

  constructor({
    realmURL,
    reader,
    instances = new URLMap(),
    modules = new Map(),
    ignoreMap = new URLMap(),
    loader,
    entrySetter,
    renderCard,
  }: {
    realmURL: URL;
    reader: Reader;
    instances?: URLMap<SearchEntryWithErrors>;
    modules?: Map<string, ModuleWithErrors>;
    ignoreMap?: URLMap<Ignore>;
    loader: Loader;
    entrySetter: EntrySetter;
    renderCard: (
      url: URL,
      staticResponses: Map<string, string>
    ) => Promise<string>;
  }) {
    this.#realmPaths = new RealmPaths(realmURL);
    this.#reader = reader;
    this.#realmURL = realmURL;
    this.#instances = instances;
    this.#modules = modules;
    this.#ignoreMap = ignoreMap;
    this.#loader = loader;
    this.#entrySetter = entrySetter;
    this.#renderCard = renderCard;
  }

  static async fromScratch(current: CurrentRun) {
    await current.visitDirectory(current.#realmURL);
    return current;
  }

  static async incremental({
    url,
    operation,
    prev,
    reader,
    loader,
    entrySetter,
    renderCard,
  }: {
    url: URL;
    operation: 'update' | 'delete';
    prev: RunState;
    reader: Reader;
    loader: Loader;
    entrySetter: EntrySetter;
    renderCard: (
      url: URL,
      staticResponses: Map<string, string>
    ) => Promise<string>;
  }) {
    let instances = new URLMap(prev.instances);
    let ignoreMap = new URLMap(prev.ignoreMap);
    let modules = new Map(prev.modules);
    instances.remove(new URL(url.href.replace(/\.json$/, '')));

    let invalidations = flatMap(invalidate(url, modules, instances), (u) =>
      // we only ever want to visit our own URL in the update case so we'll do
      // that explicitly
      u !== url.href && u !== trimExecutableExtension(url).href
        ? [new URL(u)]
        : []
    );

    let current = new this({
      realmURL: prev.realmURL,
      reader,
      instances,
      modules,
      ignoreMap,
      loader,
      entrySetter,
      renderCard,
    });

    if (operation === 'update') {
      await current.visitFile(url);
    }
    for (let invalidation of invalidations) {
      await current.visitFile(invalidation);
    }
    return current;
  }

  get instances() {
    return this.#instances;
  }

  get modules() {
    return this.#modules;
  }

  get ignoreMap() {
    return this.#ignoreMap;
  }

  get realmURL() {
    return this.#realmURL;
  }

  public get loader() {
    return this.#loader;
  }

  private async visitDirectory(url: URL): Promise<void> {
    let ignorePatterns = await this.#reader.readFileAsText(
      this.#realmPaths.local(new URL('.gitignore', url))
    );
    if (ignorePatterns && ignorePatterns.content) {
      this.#ignoreMap.set(url, ignore().add(ignorePatterns.content));
    }

    for await (let { path: innerPath, kind } of this.#reader.readdir(
      this.#realmPaths.local(url)
    )) {
      let innerURL = this.#realmPaths.fileURL(innerPath);
      if (isIgnored(this.#realmURL, this.#ignoreMap, innerURL)) {
        continue;
      }
      if (kind === 'file') {
        await this.visitFile(innerURL);
      } else {
        let directoryURL = this.#realmPaths.directoryURL(innerPath);
        await this.visitDirectory(directoryURL);
      }
    }
  }

  private async visitFile(
    url: URL,
    identityContext?: IdentityContextType,
    stack: string[] = []
  ): Promise<void> {
    if (isIgnored(this.#realmURL, this.#ignoreMap, url)) {
      return;
    }

    if (
      hasExecutableExtension(url.href) ||
      // handle modules with no extension too
      !url.href.split('/').pop()!.includes('.')
    ) {
      return await this.indexCardSource(url);
    }

    let localPath = this.#realmPaths.local(url);
    let fileRef = await this.#reader.readFileAsText(localPath);
    if (!fileRef) {
      throw new Error(`missing file ${localPath}`);
    }
    if (!identityContext) {
      let api = await this.#loader.import<typeof CardAPI>(
        `${baseRealm.url}card-api`
      );
      let { IdentityContext } = api;
      identityContext = new IdentityContext();
    }

    let { content, lastModified } = fileRef;
    if (url.href.endsWith('.json')) {
      let { data: resource } = JSON.parse(content);
      if (isCardResource(resource)) {
        await this.indexCard(
          localPath,
          lastModified,
          resource,
          identityContext,
          stack
        );
      }
    }
  }

  private async indexCardSource(url: URL): Promise<void> {
    let module: Record<string, unknown>;
    try {
      module = await this.loader.import(url.href);
    } catch (err: any) {
      this.stats.moduleErrors++;
      console.warn(
        `encountered error loading module "${url.href}": ${err.message}`
      );
      let deps = await (
        await this.loader.getConsumedModules(url.href)
      ).filter((u) => u !== url.href);
      this.#modules.set(url.href, {
        type: 'error',
        moduleURL: url.href,
        error: {
          status: 500,
          detail: `encountered error loading module "${url.href}": ${err.message}`,
          additionalErrors: null,
          deps,
        },
      });
      return;
    }

    let refs = Object.values(module)
      .filter((maybeCard) => isCard(maybeCard))
      .map((card) => identifyCard(card))
      .filter(Boolean) as CardRef[];
    for (let ref of refs) {
      if (!('type' in ref)) {
        await this.buildModule(ref.module, url);
      }
    }
  }

  private async recomputeCard(
    card: Card,
    fileURL: string,
    identityContext: IdentityContextType,
    stack: string[]
  ): Promise<void> {
    let api = await this.#loader.import<typeof CardAPI>(
      `${baseRealm.url}card-api`
    );
    try {
      await api.recompute(card, {
        loadFields: stack.length < maxLinkDepth ? true : undefined,
      });
    } catch (err: any) {
      let notLoadedErr: NotLoaded | undefined;
      if (
        isCardError(err) &&
        (notLoadedErr = [err, ...(err.additionalErrors || [])].find(
          isNotLoadedError
        ) as NotLoaded | undefined)
      ) {
        let linkURL = new URL(`${notLoadedErr.reference}.json`);
        if (this.#realmPaths.inRealm(linkURL)) {
          await this.visitFile(linkURL, identityContext, [fileURL, ...stack]);
          await this.recomputeCard(card, fileURL, identityContext, stack);
        } else {
          // in this case the instance we are linked to is a missing instance
          // in an external realm.
          throw err;
        }
      } else {
        throw err;
      }
    }
  }

  private async indexCard(
    path: LocalPath,
    lastModified: number,
    resource: LooseCardResource,
    identityContext: IdentityContextType,
    stack: string[]
  ): Promise<void> {
    let fileURL = this.#realmPaths.fileURL(path).href;
    let indexingInstance = this.#indexingInstances.get(fileURL);
    if (indexingInstance) {
      return await indexingInstance;
    }
    let deferred = new Deferred<void>();
    this.#indexingInstances.set(fileURL, deferred.promise);
    let instanceURL = new URL(
      this.#realmPaths.fileURL(path).href.replace(/\.json$/, '')
    );
    let moduleURL = new URL(
      moduleFrom(resource.meta.adoptsFrom),
      new URL(path, this.#realmURL)
    ).href;
    let typesMaybeError: TypesWithErrors | undefined;
    let uncaughtError: Error | undefined;
    let doc: SingleCardDocument | undefined;
    let searchData: Record<string, any> | undefined;
    let cardType: typeof Card | undefined;
    let html: string | undefined;
    try {
      let api = await this.#loader.import<typeof CardAPI>(
        `${baseRealm.url}card-api`
      );
      let res = { ...resource, ...{ id: instanceURL.href } };
      let card = await api.createFromSerialized<typeof Card>(
        res,
        { data: res },
        new URL(fileURL),
        {
          identityContext,
          loader: this.#loader as unknown as LoaderType,
        }
      );
      await this.recomputeCard(card, fileURL, identityContext, stack);
      cardType = Reflect.getPrototypeOf(card)?.constructor as typeof Card;
      let data = api.serializeCard(card, {
        includeComputeds: true,
      });
      // prepare the document for index serialization
      Object.values(data.data.relationships ?? {}).forEach(
        (rel) => delete (rel as Relationship).data
      );
      doc = merge(data, {
        data: {
          id: instanceURL.href,
          meta: { lastModified: lastModified },
        },
      }) as SingleCardDocument;
      searchData = await api.searchDoc(card);
      if (!searchData) {
        throw new Error(
          `bug: could not derive search doc for instance ${instanceURL.href}`
        );
      }
      let cachedDoc: SingleCardDocument = merge({}, doc, {
        data: {
          links: { self: instanceURL.href },
        },
      });
      // TODO this is the response that will feed the card rendering, but how
      // will we know how deep to load links before we have actually rendered
      // the card?
      let included = await loadLinks({
        realmURL: this.#realmURL,
        instances: this.#instances,
        loader: this.loader,
        resource: cachedDoc.data,
        omit: [cachedDoc.data.id],
      });
      if (included.length > 0) {
        cachedDoc.included = included;
      }
      this.#staticResponses.set(
        instanceURL.href,
        JSON.stringify(cachedDoc, null, 2)
      );
      html = await this.#renderCard(instanceURL, this.#staticResponses);
    } catch (err: any) {
      uncaughtError = err;
    }
    // if we already encountered an uncaught error then no need to deal with this
    if (!uncaughtError && cardType) {
      typesMaybeError = await this.getTypes(cardType);
    }
    if (searchData && doc && typesMaybeError?.type === 'types') {
      this.setInstance(instanceURL, {
        type: 'entry',
        entry: {
          resource: doc.data,
          searchData,
          html,
          types: typesMaybeError.types,
          deps: new Set(await this.loader.getConsumedModules(moduleURL)),
        },
      });
      deferred.fulfill();
    }

    if (uncaughtError || typesMaybeError?.type === 'error') {
      let error: SearchEntryWithErrors;
      if (uncaughtError) {
        error = {
          type: 'error',
          error:
            uncaughtError instanceof CardError
              ? serializableError(uncaughtError)
              : { detail: `${uncaughtError.message}` },
        };
        error.error.deps = [moduleURL];
      } else if (typesMaybeError?.type === 'error') {
        error = { type: 'error', error: typesMaybeError.error };
      } else {
        let err = new Error(`bug: should never get here`);
        deferred.fulfill();
        throw err;
      }
      console.warn(
        `encountered error indexing card instance ${path}: ${error.error.detail}`
      );
      this.setInstance(instanceURL, error);
      deferred.fulfill();
    }
  }

  private setInstance(instanceURL: URL, entry: SearchEntryWithErrors) {
    this.#instances.set(instanceURL, entry);
    this.#entrySetter(instanceURL, entry);
    if (entry.type === 'entry') {
      this.stats.instancesIndexed++;
    } else {
      this.stats.instanceErrors++;
    }
  }

  public async buildModule(
    moduleIdentifier: string,
    relativeTo = this.#realmURL
  ): Promise<void> {
    let url = new URL(moduleIdentifier, relativeTo).href;
    let existing = this.#modules.get(url);
    if (existing?.type === 'error') {
      throw new Error(
        `bug: card definition has errors which should never happen since the card already executed successfully: ${url}`
      );
    }
    if (existing) {
      return;
    }

    let working = this.#moduleWorkingCache.get(url);
    if (working) {
      await working;
      return;
    }

    let deferred = new Deferred<Module>();
    this.#moduleWorkingCache.set(url, deferred.promise);
    let m = await this.#loader.import<Record<string, any>>(moduleIdentifier);
    if (m) {
      for (let exportName of Object.keys(m)) {
        m[exportName];
      }
    }
    let consumes = (await this.loader.getConsumedModules(url)).filter(
      (u) => u !== url
    );
    let module: Module = {
      url,
      consumes,
    };
    this.#modules.set(url, { type: 'module', module });
    deferred.fulfill(module);
  }

  private async getTypes(card: typeof Card): Promise<TypesWithErrors> {
    let cached = this.#typesCache.get(card);
    if (cached) {
      return await cached;
    }
    let ref = identifyCard(card);
    if (!ref) {
      throw new Error(`could not identify card ${card.name}`);
    }
    let deferred = new Deferred<TypesWithErrors>();
    this.#typesCache.set(card, deferred.promise);
    let types: string[] = [];
    let fullRef: CardRef = ref;
    while (fullRef) {
      let loadedCard = await loadCard(fullRef, { loader: this.loader });
      let loadedCardRef = identifyCard(loadedCard);
      if (!loadedCardRef) {
        throw new Error(`could not identify card ${loadedCard.name}`);
      }
      types.push(internalKeyFor(loadedCardRef, undefined));
      if (!isEqual(loadedCardRef, baseCardRef)) {
        fullRef = {
          type: 'ancestorOf',
          card: loadedCardRef,
        };
      } else {
        break;
      }
    }
    let result: TypesWithErrors = { type: 'types', types };
    deferred.fulfill(result);
    return result;
  }
}

function invalidate(
  url: URL,
  modules: Map<string, ModuleWithErrors>,
  instances: URLMap<SearchEntryWithErrors>,
  invalidations: string[] = [],
  visited: Set<string> = new Set()
): string[] {
  if (visited.has(url.href)) {
    return [];
  }

  let invalidationSet = new Set(invalidations);
  // invalidate any instances whose deps come from the URL or whose error depends on the URL
  let invalidatedInstances = [...instances]
    .filter(([instanceURL, item]) => {
      if (item.type === 'error') {
        for (let errorModule of item.error.deps ?? []) {
          if (
            errorModule === url.href ||
            errorModule === trimExecutableExtension(url).href
          ) {
            instances.remove(instanceURL); // note this is a side-effect
            return true;
          }
        }
      } else {
        if (
          item.entry.deps.has(url.href) ||
          item.entry.deps.has(trimExecutableExtension(url).href)
        ) {
          instances.remove(instanceURL); // note this is a side-effect
          return true;
        }
      }
      return false;
    })
    .map(([u]) => `${u.href}.json`);
  for (let invalidation of invalidatedInstances) {
    invalidationSet.add(invalidation);
  }

  for (let [key, maybeError] of [...modules]) {
    if (maybeError.type === 'error') {
      // invalidate any errored modules that come from the URL
      let errorModule = maybeError.moduleURL;
      if (
        errorModule === url.href ||
        errorModule === trimExecutableExtension(url).href
      ) {
        modules.delete(key);
        invalidationSet.add(errorModule);
      }

      // invalidate any modules in an error state whose errorReference comes
      // from the URL
      for (let maybeDef of maybeError.error.deps ?? []) {
        if (
          maybeDef === url.href ||
          maybeDef === trimExecutableExtension(url).href
        ) {
          for (let invalidation of invalidate(
            new URL(errorModule),
            modules,
            instances,
            [...invalidationSet],
            new Set([...visited, url.href])
          )) {
            invalidationSet.add(invalidation);
          }
          // no need to test the other error refs, we have already decided to
          // invalidate this URL
          break;
        }
      }
      continue;
    }

    let { module } = maybeError;
    // invalidate any modules that come from the URL
    if (
      module.url === url.href ||
      module.url === trimExecutableExtension(url).href
    ) {
      modules.delete(key);
      invalidationSet.add(module.url);
    }

    // invalidate any modules that consume the URL
    for (let importURL of module.consumes) {
      if (
        importURL === url.href ||
        importURL === trimExecutableExtension(url).href
      ) {
        for (let invalidation of invalidate(
          new URL(module.url),
          modules,
          instances,
          [...invalidationSet],
          new Set([...visited, url.href])
        )) {
          invalidationSet.add(invalidation);
        }
        // no need to test the other imports, we have already decided to
        // invalidate this URL
        break;
      }
    }
  }

  return [...invalidationSet];
}
