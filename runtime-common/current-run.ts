import {
  Loader,
  baseRealm,
  LooseCardResource,
  isCardResource,
  internalKeyFor,
  hasExecutableExtension,
  trimExecutableExtension,
  type Card,
  type CardAPI,
} from ".";
import { Kind, Realm, getExportedCardContext } from "./realm";
import { RealmPaths, LocalPath } from "./paths";
import ignore, { Ignore } from "ignore";
import isEqual from "lodash/isEqual";
import { Deferred } from "./deferred";
import flatMap from "lodash/flatMap";
import merge from "lodash/merge";
import {
  isCardSingleResourceDocument,
  CardSingleResourceDocument,
} from "./search-index";
import type { ExportedCardRef, CardRef, CardResource } from "./search-index";

// Forces callers to use URL (which avoids accidentally using relative url
// strings without a base)
class URLMap<T> {
  #map: Map<string, T>;
  constructor();
  constructor(mapTuple: [key: URL, value: T][]);
  constructor(map: URLMap<T>);
  constructor(mapInit: URLMap<T> | [key: URL, value: T][] = []) {
    if (!Array.isArray(mapInit)) {
      mapInit = [...mapInit];
    }
    this.#map = new Map(mapInit.map(([key, value]) => [key.href, value]));
  }
  has(url: URL): boolean {
    return this.#map.has(url.href);
  }
  get(url: URL): T | undefined {
    return this.#map.get(url.href);
  }
  set(url: URL, value: T) {
    return this.#map.set(url.href, value);
  }
  get [Symbol.iterator]() {
    let self = this;
    return function* () {
      for (let [key, value] of self.#map) {
        yield [new URL(key), value] as [URL, T];
      }
    };
  }
  values() {
    return this.#map.values();
  }
  keys() {
    let self = this;
    return {
      get [Symbol.iterator]() {
        return function* () {
          for (let key of self.#map.keys()) {
            yield new URL(key);
          }
        };
      },
    };
  }
  get size() {
    return this.#map.size;
  }
  remove(url: URL) {
    return this.#map.delete(url.href);
  }
}

interface IndexError {
  message: string;
  errorReferences?: string[];
  // TODO we need to serialize the stack trace too, checkout the mono repo card compiler for examples
  // TODO when we support relationships we'll need to have instance references too.
}
export interface SearchEntry {
  resource: CardResource;
  searchData: Record<string, any>;
  types: string[];
  // using the internal key for the ref as a uniqueness guarantee, but
  // additionally providing the card ref object so we don't need to deserialize
  // the internal key back to a card ref
  deps: Map<string, CardRef>;
}

interface Reader {
  readFileAsText: (
    path: LocalPath,
    opts?: { withFallbacks?: true }
  ) => Promise<{ content: string; lastModified: number } | undefined>;
  readdir: (
    path: string
  ) => AsyncGenerator<{ name: string; path: string; kind: Kind }, void>;
}

interface Stats {
  instancesIndexed: number;
  instanceErrors: number;
  definitionsBuilt: number;
  moduleErrors: number;
}

export interface CardDefinition {
  id: CardRef;
  key: string; // this is used to help for JSON-API serialization
  // TODO is it actually even important to track super and fields since we can
  // get that from the card itself?
  super: CardRef | undefined; // base card has no super
  fields: Map<
    string,
    {
      fieldType: "contains" | "containsMany";
      fieldCard: CardRef;
    }
  >;
  consumedModules: string[];
}

export type SearchEntryWithErrors =
  | { type: "entry"; entry: SearchEntry }
  | { type: "error"; error: IndexError };
export type CardDefinitionWithErrors =
  | { type: "def"; def: CardDefinition }
  | { type: "error"; moduleURL: string; error: IndexError };
type DepsWithErrors =
  | { type: "deps"; deps: CardRef[] }
  | { type: "error"; error: IndexError };
type TypesWithErrors =
  | { type: "types"; types: string[] }
  | { type: "error"; error: IndexError };

export class CurrentRun {
  #instances: URLMap<SearchEntryWithErrors>;
  // I'm starting to question the need to even have card definitions in our
  // index--perhaps it's not necessary anymore...
  #definitions: Map<string, CardDefinitionWithErrors>;
  #definitionBuildCache: Map<string, Deferred<CardDefinition | undefined>> =
    new Map();
  #reader: Reader | undefined;
  #realmPaths: RealmPaths;
  #ignoreMap: URLMap<Ignore>;
  // using a map of a map so we have a uniqueness guarantee on the card refs
  // via the interior map keys so we don't end up with dupe refs
  #exportedCardRefs: URLMap<Map<string, ExportedCardRef>>;
  #loader = Loader.createLoaderFromGlobal();
  private realm: Realm;
  readonly stats: Stats = {
    instancesIndexed: 0,
    instanceErrors: 0,
    definitionsBuilt: 0,
    moduleErrors: 0,
  };

  private constructor({
    realm,
    reader,
    instances,
    definitions,
    ignoreMap,
    exportedCardRefs,
  }: {
    realm: Realm;
    reader: Reader | undefined; // the "empty" case doesn't need a reader
    instances: URLMap<SearchEntryWithErrors>;
    definitions: Map<string, CardDefinitionWithErrors>;
    ignoreMap: URLMap<Ignore>;
    exportedCardRefs: URLMap<Map<string, ExportedCardRef>>;
  }) {
    this.#realmPaths = new RealmPaths(realm.url);
    this.#reader = reader;
    this.realm = realm;
    this.#instances = instances;
    this.#definitions = definitions;
    this.#exportedCardRefs = exportedCardRefs;
    this.#ignoreMap = ignoreMap;
  }

  static empty(realm: Realm) {
    return new this({
      realm,
      reader: undefined,
      instances: new URLMap(),
      definitions: new Map(),
      exportedCardRefs: new URLMap(),
      ignoreMap: new URLMap(),
    });
  }

  static async fromScratch(realm: Realm, reader: Reader) {
    let current = new this({
      realm,
      reader,
      instances: new URLMap(),
      definitions: new Map(),
      exportedCardRefs: new URLMap(),
      ignoreMap: new URLMap(),
    });
    await current.visitDirectory(new URL(realm.url));
    await current.buildExportedCardRefs();
    return current;
  }

  static async incremental(
    url: URL,
    operation: "update" | "delete",
    prev: CurrentRun
  ) {
    let instances = new URLMap(prev.instances);
    let exportedCardRefs = new URLMap(prev.exportedCardRefs);
    let ignoreMap = new URLMap(prev.ignoreMap);
    let definitions = new Map(prev.definitions);
    instances.remove(new URL(url.href.replace(/\.json$/, "")));
    exportedCardRefs.remove(url);

    let invalidations = flatMap(invalidate(url, definitions, instances), (u) =>
      // we only ever want to visit our own URL in the update case so we'll do
      // that explicitly
      u !== url.href && u !== trimExecutableExtension(url).href
        ? [new URL(u)]
        : []
    );

    let current = new this({
      realm: prev.realm,
      reader: prev.reader,
      instances,
      exportedCardRefs,
      definitions,
      ignoreMap,
    });

    if (operation === "update") {
      await current.visitFile(url);
    }

    for (let invalidation of invalidations) {
      await current.visitFile(invalidation);
    }

    await current.buildExportedCardRefs();
    return current;
  }

  private get reader(): Reader {
    if (!this.#reader) {
      throw new Error(`The reader is not available`);
    }
    return this.#reader;
  }

  public get instances() {
    return this.#instances;
  }

  public get definitions() {
    return this.#definitions;
  }

  public get exportedCardRefs() {
    return this.#exportedCardRefs;
  }

  public get ignoreMap() {
    return this.#ignoreMap;
  }

  public get loader() {
    return this.#loader;
  }

  private async visitDirectory(url: URL): Promise<void> {
    let ignorePatterns = await this.reader.readFileAsText(
      this.#realmPaths.local(new URL(".gitignore", url))
    );
    if (ignorePatterns && ignorePatterns.content) {
      this.#ignoreMap.set(url, ignore().add(ignorePatterns.content));
    }

    for await (let { path: innerPath, kind } of this.reader.readdir(
      this.#realmPaths.local(url)
    )) {
      let innerURL = this.#realmPaths.fileURL(innerPath);
      if (this.isIgnored(innerURL)) {
        continue;
      }
      if (kind === "file") {
        await this.visitFile(innerURL);
      } else {
        let directoryURL = this.#realmPaths.directoryURL(innerPath);
        await this.visitDirectory(directoryURL);
      }
    }
  }

  private async visitFile(url: URL): Promise<void> {
    if (this.isIgnored(url)) {
      return;
    }

    if (
      (hasExecutableExtension(url.href) ||
        // handle modules with no extension too
        !url.href.split("/").pop()!.includes(".")) &&
      url.href !== `${baseRealm.url}card-api.gts` // TODO the base card's module is not analyzable
    ) {
      return await this.indexCardSource(url);
    }

    let localPath = this.#realmPaths.local(url);
    let fileRef = await this.reader.readFileAsText(localPath);
    if (!fileRef) {
      throw new Error(`missing file ${localPath}`);
    }

    let { content, lastModified } = fileRef;
    if (url.href.endsWith(".json")) {
      let { data: resource } = JSON.parse(content);
      if (isCardResource(resource)) {
        await this.indexCard(localPath, lastModified, resource);
      }
    }
  }

  private async indexCardSource(url: URL): Promise<void> {
    let module: Record<string, unknown>;
    try {
      module = await this.loader.import(url.href);
    } catch (err: any) {
      this.stats.moduleErrors++;
      if (globalThis.process?.env?.SUPPRESS_ERRORS !== "true") {
        console.warn(
          `encountered error loading module "${url.href}": ${err.message}`
        );
      }
      let errorReferences = await this.loader.getConsumedModules(url.href);
      this.#definitions.set(`error:${url.href}`, {
        type: "error",
        moduleURL: url.href,
        error: {
          message: `encountered error loading module "${url.href}": ${err.message}`,
          errorReferences,
        },
      });
      return;
    }

    let refs = Object.values(module)
      .filter(
        (maybeCard) =>
          typeof maybeCard === "function" && "baseCard" in maybeCard
      )
      .map((card) => Loader.identify(card))
      .filter(Boolean) as ExportedCardRef[];
    for (let ref of refs) {
      await this.buildDefinition({ type: "exportedCard", ...ref });
    }
  }

  private async indexCard(
    path: LocalPath,
    lastModified: number,
    resource: LooseCardResource
  ): Promise<void> {
    let instanceURL = new URL(
      this.#realmPaths.fileURL(path).href.replace(/\.json$/, "")
    );
    let moduleURL = new URL(
      resource.meta.adoptsFrom.module,
      new URL(path, this.realm.url)
    );
    let name = resource.meta.adoptsFrom.name;
    let cardRef = { module: moduleURL.href, name };
    let typesMaybeError: TypesWithErrors | undefined;
    let depsMaybeError: DepsWithErrors | undefined;
    let uncaughtError: Error | undefined;
    let doc: CardSingleResourceDocument | undefined;
    let searchData: any;
    try {
      let api = await this.#loader.import<CardAPI>(`${baseRealm.url}card-api`);
      let card = await api.createFromSerialized(resource, moduleURL, {
        loader: this.#loader,
      });
      await api.recompute(card);
      let data = api.serializeCard(card, { includeComputeds: true });
      let maybeDoc = {
        data: merge(data, {
          id: instanceURL.href,
          meta: { lastModified: lastModified },
        }),
      };
      if (!isCardSingleResourceDocument(maybeDoc)) {
        throw new Error(
          `bug: card serialization produced non-card document for ${instanceURL.href}`
        );
      }
      doc = maybeDoc;
      searchData = await api.searchDoc(card);
    } catch (err: any) {
      uncaughtError = err;
    }
    // if we already encountered an uncaught error then no need to deal with this
    if (!uncaughtError) {
      typesMaybeError = await this.getTypes(cardRef);
      depsMaybeError = await this.buildDeps({
        type: "exportedCard",
        ...cardRef,
      });
    }
    if (
      doc &&
      typesMaybeError?.type === "types" &&
      depsMaybeError?.type === "deps"
    ) {
      this.stats.instancesIndexed++;
      this.#instances.set(instanceURL, {
        type: "entry",
        entry: {
          resource: doc.data,
          searchData,
          types: typesMaybeError.types,
          deps: new Map(
            depsMaybeError.deps.map((ref) => [
              internalKeyFor(ref, undefined),
              ref,
            ]) as [string, CardRef][]
          ),
        },
      });
    }

    if (
      uncaughtError ||
      typesMaybeError?.type === "error" ||
      depsMaybeError?.type === "error"
    ) {
      this.stats.instanceErrors++;
      let error: SearchEntryWithErrors;
      if (uncaughtError) {
        error = {
          type: "error",
          error: {
            message: `${uncaughtError.message} (TODO include stack trace)`,
            errorReferences: [cardRef.module],
          },
        };
      } else if (typesMaybeError?.type === "error") {
        error = { type: "error", error: typesMaybeError.error };
      } else if (depsMaybeError?.type === "error") {
        error = { type: "error", error: depsMaybeError.error };
      } else {
        throw new Error(`bug: should never get here`);
      }
      if (globalThis.process?.env?.SUPPRESS_ERRORS !== "true") {
        console.warn(
          `encountered error indexing card instance ${path}: ${error.error.message}`
        );
      }
      this.#instances.set(instanceURL, error);
    }
  }

  private async buildExportedCardRefs() {
    for (let maybeError of this.#definitions.values()) {
      if (maybeError.type === "error") {
        continue;
      }
      let { def } = maybeError;
      if (def.id.type !== "exportedCard") {
        continue;
      }
      let { module } = def.id;
      let refsMap = this.#exportedCardRefs.get(new URL(module));
      if (!refsMap) {
        refsMap = new Map();
        this.#exportedCardRefs.set(new URL(module), refsMap);
      }
      let { type: remove, ...exportedCardRef } = def.id;
      refsMap.set(internalKeyFor(def.id, undefined), exportedCardRef);
    }
  }

  private async buildDeps(
    targetRef: CardRef,
    deps: CardRef[] = []
  ): Promise<DepsWithErrors> {
    let def = await this.buildDefinition(targetRef);
    if (!def) {
      let { module } = getExportedCardContext(targetRef);
      return {
        type: "error",
        error: {
          message: `card definition ${JSON.stringify(
            targetRef
          )} does not exist`,
          errorReferences: [module],
        },
      };
    }
    let ownRef = def.id;
    if (deps.find((ref) => isEqual(ref, ownRef))) {
      // breaks cycles
      return { type: "deps", deps };
    }
    deps.push(ownRef);
    let fieldRefs = [...def.fields.values()].map((field) => field.fieldCard);
    let superRef: CardRef | undefined;
    if (def.super) {
      superRef = def.super;
    }
    await Promise.all(
      [...fieldRefs, ...(superRef ? [superRef] : [])].map((fieldRef) =>
        this.buildDeps(fieldRef, deps)
      )
    );
    return { type: "deps", deps };
  }

  // TODO When we introduce card relationships we'll need to break cycles here
  public async buildDefinition(
    ref: CardRef,
    relativeTo = new URL(this.realm.url)
  ): Promise<CardDefinition | undefined> {
    let { module } = getExportedCardContext(ref);
    let url = new URL(module, relativeTo);
    // this key is not necessarily the same as the final CardDefinition key,
    // that key can only be determined after the card load
    let cacheKey = internalKeyFor(ref, url);
    let existing = this.#definitions.get(cacheKey);
    if (existing?.type === "error") {
      throw new Error(
        `bug: card definition has errors which should never happen since the card already executed successfully: ${cacheKey}`
      );
    }
    if (existing) {
      return existing.def;
    }
    let cachedDefinitionBuild = this.#definitionBuildCache.get(cacheKey);
    if (cachedDefinitionBuild) {
      return await cachedDefinitionBuild.promise;
    }
    let deferred = new Deferred<CardDefinition | undefined>();
    this.#definitionBuildCache.set(cacheKey, deferred);

    let createDefinition = (
      key: string,
      def: CardDefinition
    ): CardDefinition => {
      this.stats.definitionsBuilt++;
      this.#definitions.set(key, { type: "def", def });
      deferred.resolve(def);
      return def;
    };

    let noDefinition = (): undefined => {
      deferred.resolve(undefined);
      return undefined;
    };

    let {
      card,
      ref: id,
      consumedModules = [],
    } = (await this.loadCard(ref)) ?? {};
    if (!card || !id) {
      return noDefinition();
    }

    let key = internalKeyFor(id, url);
    let maybeDef = this.#definitions.get(key);
    if (maybeDef?.type === "error") {
      throw new Error(
        `bug: card definition has errors which should never happen since the card already executed successfully: ${key}`
      );
    }
    if (maybeDef) {
      return maybeDef.def;
    }

    let superDef = await this.buildDefinition({
      type: "ancestorOf",
      card: id,
    });
    if (
      !superDef &&
      !isEqual(id, {
        type: "exportedCard",
        module: `${baseRealm.url}card-api`,
        name: "Card",
      })
    ) {
      return noDefinition();
    }

    let fields: CardDefinition["fields"];
    if (superDef) {
      fields = new Map(superDef.fields);
      let api = await this.loader.import<CardAPI>(`${baseRealm.url}card-api`);
      for (let [fieldName, field] of Object.entries(
        api.getFields(card, { includeComputeds: true })
      )) {
        let fieldDef = await this.buildDefinition({
          type: "fieldOf",
          card: id,
          field: fieldName,
        });
        if (!fieldDef) {
          continue;
        }
        if (!field || typeof field !== "object" || !("containsMany" in field)) {
          throw new Error("bug: field type error");
        }
        // @ts-ignore tsc doesn't understand gts files, the type guard above should protect against this ignore
        let fieldType: "containsMany" | "contains" = field.containsMany
          ? "containsMany"
          : "contains";
        fields.set(fieldName, {
          fieldType,
          fieldCard: fieldDef.id,
        });
      }
    } else {
      fields = new Map();
    }

    return createDefinition(key, {
      id,
      key,
      super: superDef?.id,
      fields,
      consumedModules,
    });
  }

  private async getTypes(
    ref: ExportedCardRef,
    relativeTo = new URL(ref.module)
  ): Promise<TypesWithErrors> {
    let fullRef: CardRef | undefined = { type: "exportedCard", ...ref };
    let types: string[] = [];
    while (fullRef) {
      let def: CardDefinition | undefined = await this.buildDefinition(
        fullRef,
        relativeTo
      );
      if (!def) {
        let { module } = getExportedCardContext(fullRef);
        return {
          type: "error",
          error: {
            message: `Tried to getTypes of ${JSON.stringify(
              ref
            )} but couldn't find that definition relative to ${
              relativeTo.href
            }`,
            errorReferences: [module],
          },
        };
      }
      types.push(internalKeyFor(fullRef, relativeTo));
      fullRef = def.super;
    }
    return { type: "types", types };
  }

  public isIgnored(url: URL): boolean {
    if (url.href === this.realm.url) {
      return false; // you can't ignore the entire realm
    }
    if (this.ignoreMap.size === 0) {
      return false;
    }
    // Test URL against closest ignore. (Should the ignores cascade? so that the
    // child ignore extends the parent ignore?)
    let ignoreURLs = [...this.ignoreMap.keys()].map((u) => u.href);
    let matchingIgnores = ignoreURLs.filter((u) => url.href.includes(u));
    let ignoreURL = matchingIgnores.sort((a, b) => b.length - a.length)[0] as
      | string
      | undefined;
    if (!ignoreURL) {
      return false;
    }
    let ignore = this.ignoreMap.get(new URL(ignoreURL))!;
    let pathname = this.#realmPaths.local(url);
    return ignore.test(pathname).ignored;
  }

  private async loadCard(
    ref: CardRef
  ): Promise<
    { card: typeof Card; ref: CardRef; consumedModules: string[] } | undefined
  > {
    let maybeCard: unknown;
    let canonicalRef: CardRef | undefined;
    let consumedModules: string[];
    if (ref.type === "exportedCard") {
      let module = await this.loader.import<Record<string, any>>(ref.module);
      maybeCard = module[ref.name];
      consumedModules = await this.loader.getConsumedModules(ref.module);
      canonicalRef = { ...ref, ...Loader.identify(maybeCard) };
    } else if (ref.type === "ancestorOf") {
      let {
        card: child,
        ref: childRef,
        consumedModules: childConsumedMods,
      } = (await this.loadCard(ref.card)) ?? {};
      if (!child || !childRef) {
        return undefined;
      }
      maybeCard = Reflect.getPrototypeOf(child) as typeof Card;
      consumedModules = childConsumedMods ?? [];
      let cardId = Loader.identify(maybeCard);
      canonicalRef = cardId
        ? { type: "exportedCard", ...cardId }
        : { ...ref, card: childRef };
    } else if (ref.type === "fieldOf") {
      let {
        card: parent,
        ref: parentRef,
        consumedModules: parentConsumedMods,
      } = (await this.loadCard(ref.card)) ?? {};
      if (!parent || !parentRef) {
        return undefined;
      }
      let api = await this.loader.import<CardAPI>(`${baseRealm.url}card-api`);
      let field = api.getField(parent, ref.field);
      maybeCard = field?.card;
      consumedModules = parentConsumedMods ?? [];
      let cardId = Loader.identify(maybeCard);
      canonicalRef = cardId
        ? { type: "exportedCard", ...cardId }
        : { ...ref, card: parentRef };
    } else {
      throw assertNever(ref);
    }

    if (
      typeof maybeCard === "function" &&
      "baseCard" in maybeCard &&
      canonicalRef
    ) {
      return {
        card: maybeCard as unknown as typeof Card,
        ref: canonicalRef,
        consumedModules,
      };
    } else {
      return undefined;
    }
  }
}

function invalidate(
  url: URL,
  definitions: Map<string, CardDefinitionWithErrors>,
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
      if (item.type === "error") {
        for (let errorModule of item.error.errorReferences ?? []) {
          if (
            errorModule === url.href ||
            errorModule === trimExecutableExtension(url).href
          ) {
            instances.remove(instanceURL); // note this is a side-effect
            return true;
          }
        }
      } else {
        let depModules = [...item.entry.deps.values()].map(
          (ref) => getExportedCardContext(ref).module
        );
        if (
          depModules.includes(url.href) ||
          depModules.includes(trimExecutableExtension(url).href)
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

  for (let [key, maybeError] of [...definitions]) {
    if (maybeError.type === "error") {
      // invalidate any errored definitions that come from the URL
      let errorModule = maybeError.moduleURL;
      if (
        errorModule === url.href ||
        errorModule === trimExecutableExtension(url).href
      ) {
        definitions.delete(key);
        invalidationSet.add(errorModule);
      }

      // invalidate any definitions in an error state whose errorReference comes
      // from the URL
      for (let maybeDef of maybeError.error.errorReferences ?? []) {
        if (
          maybeDef === url.href ||
          maybeDef === trimExecutableExtension(url).href
        ) {
          for (let invalidation of invalidate(
            new URL(errorModule),
            definitions,
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

    let { def } = maybeError;
    let defModule = getExportedCardContext(def.id).module;
    // invalidate any definitions that come from the URL
    if (
      defModule === url.href ||
      defModule === trimExecutableExtension(url).href
    ) {
      definitions.delete(key);
      invalidationSet.add(defModule);
    }

    // invalidate any definitions whose imports come from the URL
    for (let importURL of def.consumedModules) {
      if (
        importURL === url.href ||
        importURL === trimExecutableExtension(url).href
      ) {
        for (let invalidation of invalidate(
          new URL(defModule),
          definitions,
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

function assertNever(value: never) {
  return new Error(`should never happen ${value}`);
}
