import { baseRealm, LooseCardResource, isCardResource } from ".";
import {
  Kind,
  Realm,
  CardDefinitionResource,
  getExportedCardContext,
} from "./realm";
import { RealmPaths, LocalPath } from "./paths";
import { ModuleSyntax } from "./module-syntax";
import { ClassReference } from "./schema-analysis-plugin";
import ignore, { Ignore } from "ignore";
import isEqual from "lodash/isEqual";
import { stringify } from "qs";
import { Loader } from "./loader";
import { Deferred } from "./deferred";
import flatMap from "lodash/flatMap";
import merge from "lodash/merge";
import {
  hasExecutableExtension,
  trimExecutableExtension,
  isCardDocument,
  internalKeyFor,
  CardDocument,
} from "./search-index";
//@ts-ignore realm server TSC doesn't know how to deal with this because it doesn't understand glint
import type { Card } from "https://cardstack.com/base/card-api";
import type {
  CardDefinition,
  ExportedCardRef,
  CardRef,
  CardResource,
} from "./search-index";
//@ts-ignore realm server TSC doesn't know how to deal with this because it doesn't understand glint
type CardAPI = typeof import("https://cardstack.com/base/card-api");

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
  errorReference?: CardRef;
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
  definitionErrors: number;
  modulesAnalyzed: number;
}

export type SearchEntryWithErrors =
  | { type: "entry"; entry: SearchEntry }
  | { type: "error"; error: IndexError };
export type CardDefinitionWithErrors =
  | { type: "def"; def: CardDefinition }
  | { type: "error"; id: CardRef; error: IndexError };
type DepsWithErrors =
  | { type: "deps"; deps: CardRef[] }
  | { type: "error"; error: IndexError };
type TypesWithErrors =
  | { type: "types"; types: string[] }
  | { type: "error"; error: IndexError };

export class CurrentRun {
  #instances: URLMap<SearchEntryWithErrors>;
  #modules: URLMap<Deferred<ModuleSyntax>>;
  #definitions: Map<string, CardDefinitionWithErrors>;
  #definitionBuildCache: Map<
    string,
    Deferred<CardDefinitionWithErrors | undefined>
  > = new Map();
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
    definitionErrors: 0,
    modulesAnalyzed: 0,
  };

  private constructor({
    realm,
    reader,
    instances,
    modules,
    definitions,
    ignoreMap,
    exportedCardRefs,
  }: {
    realm: Realm;
    reader: Reader | undefined; // the "empty" case doesn't need a reader
    instances: URLMap<SearchEntryWithErrors>;
    modules: URLMap<Deferred<ModuleSyntax>>;
    definitions: Map<string, CardDefinitionWithErrors>;
    ignoreMap: URLMap<Ignore>;
    exportedCardRefs: URLMap<Map<string, ExportedCardRef>>;
  }) {
    this.#realmPaths = new RealmPaths(realm.url);
    this.#reader = reader;
    this.realm = realm;
    this.#instances = instances;
    this.#modules = modules;
    this.#definitions = definitions;
    this.#exportedCardRefs = exportedCardRefs;
    this.#ignoreMap = ignoreMap;
  }

  static empty(realm: Realm) {
    return new this({
      realm,
      reader: undefined,
      instances: new URLMap(),
      modules: new URLMap(),
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
      modules: new URLMap(),
      // TODO need to investigate the syntax analysis of the base card--if that
      // is not possible to do, then we should seed it here
      definitions: new Map([
        // seed the definitions with the base card
        [
          internalKeyFor(
            {
              type: "exportedCard",
              module: `${baseRealm.url}card-api`,
              name: "Card",
            },
            undefined
          ),
          {
            type: "def",
            def: {
              id: {
                type: "exportedCard",
                module: `${baseRealm.url}card-api`,
                name: "Card",
              },
              key: internalKeyFor(
                {
                  type: "exportedCard",
                  module: `${baseRealm.url}card-api`,
                  name: "Card",
                },
                undefined
              ),
              super: undefined,
              fields: new Map(),
            },
          },
        ],
      ]),
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
    let modules = new URLMap(prev.#modules);
    let exportedCardRefs = new URLMap(prev.exportedCardRefs);
    let ignoreMap = new URLMap(prev.ignoreMap);
    let definitions = new Map(prev.definitions);

    modules.remove(url);
    modules.remove(trimExecutableExtension(url));
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
      modules,
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
    let mod = await this.parseModule(url);
    if (!mod) {
      return;
    }
    await Promise.all(
      mod.possibleCards
        .filter((possibleCard) => possibleCard.exportedAs)
        .map((possibleCard) =>
          this.buildDefinition({
            type: "exportedCard",
            module: url.href,
            name: possibleCard.exportedAs!,
          })
        )
    );
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
    let doc: CardDocument | undefined;
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
      if (!isCardDocument(maybeDoc)) {
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
            errorReference: { type: "exportedCard", ...cardRef },
          },
        };
      } else if (typesMaybeError?.type === "error") {
        error = { type: "error", error: typesMaybeError.error };
      } else if (depsMaybeError?.type === "error") {
        error = { type: "error", error: depsMaybeError.error };
      } else {
        throw new Error(`bug: should never get here`);
      }
      console.warn(
        `encountered error indexing card instance ${path}: ${error.error.message}`
      );
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
    let maybeError = await this.buildDefinition(targetRef);
    if (!maybeError || maybeError.type === "error") {
      return {
        type: "error",
        error: {
          message: `card definition ${JSON.stringify(
            targetRef
          )}  does not exist${
            maybeError?.type === "error"
              ? `. caused by error: ` + maybeError.error.message
              : ""
          }`,
          errorReference: targetRef,
        },
      };
    }
    let { def } = maybeError;
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

  // This may return undefined because from a syntax perspective this module was
  // consumed by something that appeared to be a card, but it may turn out that
  // the syntax analysis of this module results in no cards being found.
  private async parseModule(url: URL): Promise<ModuleSyntax | undefined> {
    if (!this.#realmPaths.inRealm(url)) {
      return;
    }

    let deferred = this.#modules.get(url);
    if (deferred) {
      return await deferred.promise;
    }

    deferred = new Deferred<ModuleSyntax>();
    this.stats.modulesAnalyzed++;
    this.#modules.set(url, deferred);
    this.#modules.set(trimExecutableExtension(url), deferred);

    let localPath = this.#realmPaths.local(url);
    let fileRef = await this.reader.readFileAsText(localPath, {
      withFallbacks: true,
    });
    if (!fileRef) {
      return undefined; // npm modules will fall thru here
    }

    let { content } = fileRef;
    let mod = new ModuleSyntax(content);
    deferred?.fulfill(mod);
    return mod;
  }

  // TODO When we introduce card relationships we'll need to break cycles here
  public async buildDefinition(
    ref: CardRef,
    relativeTo = new URL(this.realm.url)
  ): Promise<CardDefinitionWithErrors | undefined> {
    let { module } = getExportedCardContext(ref);
    let url = new URL(module, relativeTo);
    // this key is not necessarily the same as the final CardDefinition key,
    // that key can only be determined after the syntax analysis
    let cacheKey = internalKeyFor(ref, url);
    let existing = this.#definitions.get(cacheKey);
    if (existing) {
      return existing;
    }
    let cachedDefinitionBuild = this.#definitionBuildCache.get(cacheKey);
    if (cachedDefinitionBuild) {
      return await cachedDefinitionBuild.promise;
    }
    let deferred = new Deferred<CardDefinitionWithErrors | undefined>();
    this.#definitionBuildCache.set(cacheKey, deferred);

    let createDefinition = (
      key: string,
      def: CardDefinitionWithErrors
    ): CardDefinitionWithErrors => {
      this.stats.definitionsBuilt++;
      this.#definitions.set(key, def);
      deferred.resolve(def);
      return def;
    };

    let noDefinition = (): undefined => {
      deferred.resolve(undefined);
      return undefined;
    };

    let handleError = (
      id: CardRef,
      key: string,
      message: string
    ): CardDefinitionWithErrors => {
      let error: CardDefinitionWithErrors = {
        type: "error",
        id,
        error: { message },
      };
      this.stats.definitionErrors++;
      this.#definitions.set(key, error);
      deferred.resolve(error);
      return error;
    };

    if (
      !this.#realmPaths.inRealm(
        new URL(getExportedCardContext(ref).module, relativeTo)
      )
    ) {
      if (ref.type !== "exportedCard") {
        return handleError(
          ref,
          cacheKey,
          `Cannot get non-exported card ref from module in a different realm: ${JSON.stringify(
            ref
          )}`
        );
      }
      let def = await this.getExternalCardDefinition(ref);
      if (!def) {
        return handleError(
          ref,
          cacheKey,
          `card ref from different realm could not be found ${JSON.stringify(
            ref
          )}`
        );
      }
      // in this case the cacheKey is the actual definition id
      return createDefinition(cacheKey, def);
    }

    let parsedModule = await this.parseModule(url);
    if (!parsedModule) {
      return noDefinition();
    }
    let found = parsedModule.find(ref);
    if (!found) {
      // this ref from a syntax perspective appeared to be a card, but from a
      // semantic perspective it actually is not a card
      return noDefinition();
    }
    if (found.result === "remote") {
      let promise = this.buildDefinition(found.ref, url);
      deferred.fulfill(promise);
      return await promise;
    }

    let possibleCard = found.class;
    let id: CardRef = possibleCard.exportedAs
      ? {
          type: "exportedCard",
          module: trimExecutableExtension(new URL(url, this.realm.url)).href,
          name: possibleCard.exportedAs,
        }
      : ref;
    let key = internalKeyFor(id, url);
    let def = this.#definitions.get(key);
    if (def && key !== cacheKey) {
      return createDefinition(cacheKey, def); // we are providing the existing definition at cacheKey too
    }

    let superDefMaybeError = await this.buildDefinition({
      type: "ancestorOf",
      card: id,
    });
    if (!superDefMaybeError) {
      return noDefinition();
    }
    if (superDefMaybeError.type === "error") {
      // something to think about: our error doesn't have an absolute card
      // ref that it can use to trigger the invalidation of the error
      // document. which means we might have to always invalidate definition
      // error results
      return handleError(
        id,
        key,
        `parent definition of ${JSON.stringify(id)} has indexing errors: ${
          superDefMaybeError.error.message
        }`
      );
    }

    let fields: CardDefinition["fields"] = new Map(
      superDefMaybeError.def.fields
    );
    let fieldErrors: string[] = [];
    for (let [fieldName, possibleField] of possibleCard.possibleFields) {
      if (!isOurFieldDecorator(possibleField.decorator, url)) {
        continue;
      }
      let fieldType = getFieldType(possibleField.type, url);
      if (!fieldType) {
        continue;
      }
      let fieldDefMaybeError = await this.buildDefinition({
        type: "fieldOf",
        card: id,
        field: fieldName,
      });
      if (fieldDefMaybeError?.type === "error") {
        // something to think about: our error doesn't have an absolute card
        // ref that it can use to trigger the invalidation of the error
        // document. which means we might have to always invalidate definition
        // error results
        fieldErrors.push(
          `the definition for the field "${fieldName}" of card ${JSON.stringify(
            id
          )} has indexing errors: ${fieldDefMaybeError.error.message}`
        );
      } else if (fieldDefMaybeError) {
        fields.set(fieldName, {
          fieldType,
          fieldCard: fieldDefMaybeError.def.id,
        });
      }
    }
    if (fieldErrors.length > 0) {
      return handleError(id, key, fieldErrors.join(". "));
    }

    return createDefinition(key, {
      type: "def",
      def: { id, key, super: superDefMaybeError.def.id, fields },
    });
  }

  public async getExternalCardDefinition(
    ref: ExportedCardRef
  ): Promise<CardDefinitionWithErrors | undefined> {
    let url = `${ref.module}/_typeOf?${stringify({
      type: "exportedCard",
      ...ref,
    })}`;
    let response = await this.#loader.fetch(url, {
      headers: {
        Accept: "application/vnd.api+json",
      },
    });
    if (!response.ok) {
      console.log(`Could not get card type for ${url}: ${response.status}`);
      return undefined;
    }

    let resource: CardDefinitionResource = (await response.json()).data;
    let def: CardDefinitionWithErrors = {
      type: "def",
      def: {
        id: resource.attributes.cardRef,
        key: resource.id,
        super: resource.relationships._super?.meta.ref,
        fields: new Map(
          Object.entries(resource.relationships)
            .filter(([fieldName]) => fieldName !== "_super")
            .map(([fieldName, fieldInfo]) => [
              fieldName,
              {
                fieldType: fieldInfo.meta.type as "contains" | "containsMany",
                fieldCard: fieldInfo.meta.ref,
              },
            ])
        ),
      },
    };
    return def;
  }

  private async getTypes(
    ref: ExportedCardRef,
    relativeTo = new URL(ref.module)
  ): Promise<TypesWithErrors> {
    let fullRef: CardRef | undefined = { type: "exportedCard", ...ref };
    let types: string[] = [];
    while (fullRef) {
      let maybeError: CardDefinitionWithErrors | undefined =
        await this.buildDefinition(fullRef, relativeTo);
      if (!maybeError || maybeError.type === "error") {
        return {
          type: "error",
          error: {
            message: `Tried to getTypes of ${JSON.stringify(
              ref
            )} but couldn't find that definition relative to ${
              relativeTo.href
            }${
              maybeError?.type === "error"
                ? `. caused by error: ` + maybeError.error.message
                : ""
            }`,
            errorReference: fullRef,
          },
        };
      }
      types.push(internalKeyFor(fullRef, relativeTo));
      fullRef = maybeError.def.super;
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
}

function isOurFieldDecorator(ref: ClassReference, inModule: URL): boolean {
  return (
    ref.type === "external" &&
    new URL(ref.module, inModule).href === baseRealm.fileURL("card-api").href &&
    ref.name === "field"
  );
}

function getFieldType(
  ref: ClassReference,
  inModule: URL
): "contains" | "containsMany" | undefined {
  if (
    ref.type === "external" &&
    new URL(ref.module, inModule).href === baseRealm.fileURL("card-api").href &&
    ["contains", "containsMany"].includes(ref.name)
  ) {
    return ref.name as ReturnType<typeof getFieldType>;
  }
  return undefined;
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
        let errorModule = item.error.errorReference
          ? getExportedCardContext(item.error.errorReference).module
          : undefined;
        if (
          errorModule === url.href ||
          errorModule === trimExecutableExtension(url).href
        ) {
          instances.remove(instanceURL); // note this is a side-effect
          return true;
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

  for (let [key, maybeError] of definitions) {
    // the definition errors don't have an absolute card reference that they can
    // use to trigger invalidation, so until that is taken care of we probably
    // should always invalidate card definition errors
    if (maybeError.type === "error") {
      invalidationSet.add(getExportedCardContext(maybeError.id).module);
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
      invalidationSet.add(getExportedCardContext(def.id).module);
    }

    // invalidate any definitions whose super comes from the URL
    let superModule = def.super
      ? getExportedCardContext(def.super).module
      : undefined;
    if (
      superModule &&
      (superModule === url.href ||
        superModule === trimExecutableExtension(url).href)
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
      // no need to bother looking into this definition's fields, we've already
      // decided to invalidate it
      continue;
    }

    // invalidate any definitions whose fields from from the URL
    for (let field of def.fields.values()) {
      let fieldModule = getExportedCardContext(field.fieldCard).module;
      if (
        fieldModule === url.href ||
        fieldModule === trimExecutableExtension(url).href
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
        // no need to bother looking into other fields on this definition,
        // we've already decided to invalidate it
        break;
      }
    }
  }

  return [...invalidationSet];
}
