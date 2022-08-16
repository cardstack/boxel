import { baseRealm } from ".";
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
import { stringify } from "qs";
import { Loader } from "./loader";
import { Deferred } from "./deferred";
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

export interface SearchEntry {
  resource: CardResource;
  searchData: Record<string, any>;
  types: string[];
  // using the internal key for the ref as a uniqueness guarantee, but
  // additionally providing the card ref object so we don't need to deserialize
  // the internal key back to a card ref
  refs: Map<string, CardRef>;
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

// TODO move this into a better place
let externalDefinitionsCache = new Map<
  string,
  Promise<CardDefinition | undefined>
>();

export class CurrentRun {
  #instances: URLMap<SearchEntry>;
  #modules: URLMap<Deferred<ModuleSyntax>>;
  #definitions: Map<string, CardDefinition>;
  #reader: Reader | undefined;
  #realmPaths: RealmPaths;
  #api: CardAPI | undefined;
  #ignoreMap: URLMap<Ignore>;
  // using a map of a map so we have a uniqueness guarantee on the card refs
  // via the interior map keys so we don't end up with dupe refs
  #exportedCardRefs: Map<string, Map<string, ExportedCardRef>>;
  private realm: Realm;
  private incremental: { url: URL; operation: "update" | "delete" } | undefined;

  private constructor({
    realm,
    reader,
    instances,
    modules,
    definitions,
    ignoreMap,
    exportedCardRefs,
    incremental,
  }: {
    realm: Realm;
    reader: Reader | undefined; // the "empty" case doesn't need a reader
    instances: URLMap<SearchEntry>;
    modules: URLMap<Deferred<ModuleSyntax>>;
    definitions: Map<string, CardDefinition>;
    ignoreMap: URLMap<Ignore>;
    exportedCardRefs: Map<string, Map<string, ExportedCardRef>>;
    incremental: { url: URL; operation: "update" | "delete" } | undefined;
  }) {
    this.#realmPaths = new RealmPaths(realm.url);
    this.#reader = reader;
    this.realm = realm;
    this.#instances = instances;
    this.#modules = modules;
    this.#definitions = definitions;
    this.incremental = incremental;
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
      incremental: undefined,
      exportedCardRefs: new Map(),
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
        ],
      ]),
      incremental: undefined,
      exportedCardRefs: new Map(),
      ignoreMap: new URLMap(),
    });
    await current.run();
    return current;
  }

  static async incremental(
    url: URL,
    operation: "update" | "delete",
    prev: CurrentRun
  ) {
    let instances = new URLMap(prev.instances);
    let modules = new URLMap(prev.#modules);
    let exportedCardRefs = new Map(prev.exportedCardRefs);
    let ignoreMap = new URLMap(prev.ignoreMap);
    let definitions = new Map(prev.definitions);
    // TODO refactor this away via invalidation mechanism...
    removeDefinitions(url, definitions);
    let current = new this({
      realm: prev.realm,
      reader: prev.reader,
      instances,
      exportedCardRefs,
      modules,
      definitions,
      ignoreMap,
      incremental: {
        url,
        operation,
      },
    });
    await current.run();
    return current;
  }

  public get api(): CardAPI {
    if (!this.#api) {
      throw new Error(`Card API was accessed before it was loaded`);
    }
    return this.#api;
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

  private async run() {
    this.#api = await Loader.import<CardAPI>(`${baseRealm.url}card-api`);
    if (this.incremental) {
      await this.visitFile(this.incremental.url, {
        delete: this.incremental.operation === "delete",
      });
    } else {
      await this.visitDirectory(new URL(this.realm.url));
    }
    await this.buildExportedCardRefs();
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

  private async visitFile(
    url: URL,
    opts?: { delete?: boolean }
  ): Promise<void> {
    if (this.isIgnored(url)) {
      return;
    }

    if (
      hasExecutableExtension(url.href) &&
      url.href !== `${baseRealm.url}card-api.gts` // TODO the base card's module is not analyzable
    ) {
      if (opts?.delete) {
        this.#modules.remove(url);
        this.#modules.remove(trimExecutableExtension(url));
      } else {
        let mod = await this.parseModule(url);
        if (!mod) {
          return;
        }

        for (let possibleCard of mod.possibleCards) {
          if (possibleCard.exportedAs) {
            await this.buildDefinition({
              type: "exportedCard",
              module: url.href,
              name: possibleCard.exportedAs,
            });
          }
        }
      }
    }

    let localPath = this.#realmPaths.local(url);
    let fileRef = await this.reader.readFileAsText(localPath);
    if (!fileRef) {
      this.#modules.remove(url);
      return;
    }

    let { content, lastModified } = fileRef;
    if (url.href.endsWith(".json")) {
      let json = JSON.parse(content);
      if (isCardDocument(json)) {
        await this.indexCardDocument(localPath, lastModified, json, opts);
      }
    }
  }

  private async indexCardDocument(
    path: LocalPath,
    lastModified: number,
    doc: CardDocument,
    opts?: { delete?: boolean }
  ): Promise<void> {
    let instanceURL = new URL(
      this.#realmPaths.fileURL(path).href.replace(/\.json$/, "")
    );
    if (opts?.delete && this.#instances.get(instanceURL)) {
      this.#instances.remove(instanceURL);
    } else {
      doc.data.id = instanceURL.href;
      doc.data.meta.lastModified = lastModified;
      let moduleURL = new URL(
        doc.data.meta.adoptsFrom.module,
        new URL(path, this.realm.url)
      );
      let name = doc.data.meta.adoptsFrom.name;
      let cardRef = { module: moduleURL.href, name };
      let module = await Loader.import<Record<string, any>>(moduleURL.href);
      let CardClass = module[name] as typeof Card;
      let card = CardClass.fromSerialized(doc.data.attributes);
      let searchData = await this.api.searchDoc(card);
      await this.buildDefinition({
        type: "exportedCard",
        ...cardRef,
      });
      this.#instances.set(instanceURL, {
        resource: doc.data,
        searchData,
        types: await this.getTypes(cardRef),
        refs: new Map(
          (await this.buildRefs(cardRef)).map((ref) => [
            internalKeyFor({ type: "exportedCard", ...ref }, undefined),
            { type: "exportedCard", ...ref },
          ]) as [string, CardRef][]
        ),
      });
    }
  }

  // TODO this should only operated on the touched modules
  private async buildExportedCardRefs() {
    for (let def of this.#definitions.values()) {
      if (def.id.type !== "exportedCard") {
        continue;
      }
      let { module } = def.id;
      let refsMap = this.#exportedCardRefs.get(module);
      if (!refsMap) {
        refsMap = new Map();
        this.#exportedCardRefs.set(module, refsMap);
      }
      let { type: remove, ...exportedCardRef } = def.id;
      refsMap.set(internalKeyFor(def.id, undefined), exportedCardRef);
    }
  }

  // TODO ideally we probably want more than just exported card refs...
  private async buildRefs(
    targetRef: ExportedCardRef,
    refs: ExportedCardRef[] = []
  ): Promise<ExportedCardRef[]> {
    let def = await this.getCardDefinition(targetRef);
    if (!def) {
      // figure out a way to report this without breaking indexing
      throw new Error(
        `todo: card definition ${JSON.stringify(targetRef)} does not exist`
      );
    }
    let ownRef = def.id;
    if (ownRef.type !== "exportedCard") {
      throw new Error(
        `bug - unimplemented don't know how to get non exported ref: ${JSON.stringify(
          ownRef
        )}`
      );
    }
    if (
      refs.find(
        (ref) =>
          ref.module === (ownRef as ExportedCardRef).module &&
          ref.name === (ownRef as ExportedCardRef).name
      )
    ) {
      return refs;
    }
    refs.push(ownRef);
    let fieldRefs = [...def.fields.values()].map((field) => field.fieldCard);
    let nonExportedCardRef = fieldRefs.find(
      (ref) => ref.type !== "exportedCard"
    );
    if (nonExportedCardRef) {
      throw new Error(
        `bug - unimplemented don't know how to get non exported ref: ${JSON.stringify(
          nonExportedCardRef
        )}`
      );
    }
    let superRef: ExportedCardRef | undefined;
    if (def.super) {
      if (def.super.type !== "exportedCard") {
        throw new Error(
          `bug - unimplemented don't know how to get non exported ref: ${JSON.stringify(
            superRef
          )}`
        );
      }
      superRef = def.super;
    }
    await Promise.all(
      (
        [...fieldRefs, ...(superRef ? [superRef] : [])] as ExportedCardRef[]
      ).map((fieldRef) => this.buildRefs(fieldRef, refs))
    );

    return refs;
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

  // TODO use cached promises here to share work, but beware of cycles!
  public async buildDefinition(
    ref: CardRef,
    relativeTo = new URL(this.realm.url)
  ): Promise<CardDefinition | undefined> {
    let { module } = getExportedCardContext(ref);
    let url = new URL(module, relativeTo);
    let parsedModule = await this.parseModule(url);
    if (!parsedModule) {
      return undefined;
    }

    let found = parsedModule.find(ref);
    if (!found) {
      // this ref from a syntax perspective appeared to be a card, but from a
      // semantic perspective it actually is not a card
      return undefined;
    }
    if (found.result === "remote") {
      return await this.buildDefinition(found.ref, url);
    }

    let possibleCard = found.class;

    let id: CardRef = possibleCard.exportedAs
      ? {
          type: "exportedCard",
          module: trimExecutableExtension(new URL(url, this.realm.url)).href,
          name: possibleCard.exportedAs,
        }
      : ref;

    let def = this.#definitions.get(internalKeyFor(id, url));
    if (def) {
      this.#definitions.set(internalKeyFor(ref, url), def);
      return def;
    }

    let superDef = await this.definitionForClassRef(url, possibleCard.super, {
      type: "ancestorOf",
      card: id,
    });

    if (!superDef) {
      return undefined;
    }

    let fields: CardDefinition["fields"] = new Map(superDef.fields);

    for (let [fieldName, possibleField] of possibleCard.possibleFields) {
      if (!isOurFieldDecorator(possibleField.decorator, url)) {
        continue;
      }
      let fieldType = getFieldType(possibleField.type, url);
      if (!fieldType) {
        continue;
      }
      let fieldDef = await this.definitionForClassRef(url, possibleField.card, {
        type: "fieldOf",
        card: id,
        field: fieldName,
      });
      if (fieldDef) {
        fields.set(fieldName, { fieldType, fieldCard: fieldDef.id });
      }
    }

    let key = internalKeyFor(id, url);
    def = { id, key, super: superDef.id, fields };
    this.#definitions.set(key, def);
    return def;
  }

  private async definitionForClassRef(
    url: URL,
    ref: ClassReference,
    targetRef: CardRef
  ): Promise<CardDefinition | undefined> {
    if (ref.type === "internal") {
      return await this.buildDefinition(targetRef);
    } else {
      if (this.isLocal(new URL(ref.module, url))) {
        if (
          baseRealm.fileURL(ref.module).href === `${baseRealm.url}card-api` &&
          ref.name === "Card"
        ) {
          let { module, name } = ref;
          return this.definitions.get(
            internalKeyFor({ module, name, type: "exportedCard" }, url)
          );
        }
        return await this.buildDefinition(targetRef);
      } else {
        return await this.getExternalCardDefinition({
          name: ref.name,
          module: ref.module,
        });
      }
    }
  }

  private isLocal(url: URL): boolean {
    return url.href.startsWith(this.realm.url);
  }

  private async getExternalCardDefinition(
    ref: ExportedCardRef
  ): Promise<CardDefinition | undefined> {
    let key = internalKeyFor({ type: "exportedCard", ...ref }, undefined); // these should always be absolute URLs
    let promise = externalDefinitionsCache.get(key);
    if (promise) {
      return await promise;
    }
    let deferred = new Deferred<CardDefinition | undefined>();
    externalDefinitionsCache.set(key, deferred.promise);

    let url = `${ref.module}/_typeOf?${stringify({
      type: "exportedCard",
      ...ref,
    })}`;
    let response = await Loader.fetch(url, {
      headers: {
        Accept: "application/vnd.api+json",
      },
    });
    if (!response.ok) {
      console.log(`Could not get card type for ${url}: ${response.status}`);
      deferred.fulfill(undefined);
      return undefined;
    }

    let resource: CardDefinitionResource = (await response.json()).data;
    let def: CardDefinition = {
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
    };
    deferred.fulfill(def);
    return def;
  }

  private async getTypes(
    ref: ExportedCardRef,
    relativeTo = new URL(ref.module)
  ): Promise<string[]> {
    let fullRef: CardRef | undefined = { type: "exportedCard", ...ref };
    let types: string[] = [];
    while (fullRef) {
      let def: CardDefinition | undefined = await this.typeOf(
        fullRef,
        relativeTo
      );
      if (!def) {
        // TODO: create a way to report this error without breaking indexing
        throw new Error(
          `Tried to getTypes of ${JSON.stringify(
            ref
          )} but couldn't find that definition`
        );
      }
      types.push(internalKeyFor(fullRef, relativeTo));
      fullRef = def.super;
    }
    return types;
  }

  public async getCardDefinition(
    ref: ExportedCardRef
  ): Promise<CardDefinition | undefined> {
    return (
      this.definitions.get(
        internalKeyFor({ type: "exportedCard", ...ref }, undefined) // assumes ref refers to absolute module URL
      ) ?? (await this.getExternalCardDefinition(ref))
    );
  }

  async typeOf(
    ref: CardRef,
    relativeTo = new URL(this.realm.url)
  ): Promise<CardDefinition | undefined> {
    let def = this.definitions.get(internalKeyFor(ref, relativeTo));
    if (def) {
      return def;
    }
    let { module } = getExportedCardContext(ref);
    let moduleURL = new URL(module, relativeTo);
    if (!this.realm.paths.inRealm(moduleURL) && ref.type === "exportedCard") {
      return await this.getExternalCardDefinition(ref);
    }
    return undefined;
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

function removeDefinitions(url: URL, definitions: Map<string, CardDefinition>) {
  for (let [key, def] of definitions) {
    let defModule = getExportedCardContext(def.id).module;
    if (
      defModule === url.href ||
      defModule === trimExecutableExtension(url).href
    ) {
      definitions.delete(key);
    }
    let superModule = def.super
      ? getExportedCardContext(def.super).module
      : undefined;
    if (
      (superModule && superModule === url.href) ||
      superModule === trimExecutableExtension(url).href
    ) {
      removeDefinitions(new URL(superModule), definitions);
    }
  }
}
