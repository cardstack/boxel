import { executableExtensions, baseRealm } from ".";
import { Kind, Realm, CardDefinitionResource } from "./realm";
import { RealmPaths, LocalPath } from "./paths";
import { ModuleSyntax } from "./module-syntax";
import { ClassReference, PossibleCardClass } from "./schema-analysis-plugin";
import ignore, { Ignore } from "ignore";
import { stringify } from "qs";
import { Query, Filter, assertQuery } from "./query";

export type CardRef =
  | {
      type: "exportedCard";
      module: string;
      name: string;
    }
  | {
      type: "ancestorOf";
      card: CardRef;
    }
  | {
      type: "fieldOf";
      card: CardRef;
      field: string;
    };

export function isCardRef(ref: any): ref is CardRef {
  if (typeof ref !== "object") {
    return false;
  }
  if (!("type" in ref)) {
    return false;
  }
  if (ref.type === "exportedCard") {
    if (!("module" in ref) || !("name" in ref)) {
      return false;
    }
    return typeof ref.module === "string" && typeof ref.name === "string";
  } else if (ref.type === "ancestorOf") {
    if (!("card" in ref)) {
      return false;
    }
    return isCardRef(ref.card);
  } else if (ref.type === "fieldOf") {
    if (!("card" in ref) || !("field" in ref)) {
      return false;
    }
    if (typeof ref.card !== "object" || typeof ref.field !== "string") {
      return false;
    }
    return isCardRef(ref.card);
  }
  return false;
}

// TODO
export type Saved = string;
export type Unsaved = string | undefined;
export interface CardResource<Identity extends Unsaved = Saved> {
  id: Identity;
  type: "card";
  attributes?: Record<string, any>;
  searchData?: Record<string, any>;
  // TODO add relationships
  meta: {
    adoptsFrom: {
      module: string;
      name: string;
    };
    lastModified?: number;
  };
  links?: {
    self?: string;
  };
}
export interface CardDocument<Identity extends Unsaved = Saved> {
  data: CardResource<Identity>;
}

export function isCardResource(resource: any): resource is CardResource {
  if (typeof resource !== "object") {
    return false;
  }
  if ("id" in resource && typeof resource.id !== "string") {
    return false;
  }
  if (!("type" in resource) || resource.type !== "card") {
    return false;
  }
  if ("attributes" in resource && typeof resource.attributes !== "object") {
    return false;
  }
  if (!("meta" in resource) || typeof resource.meta !== "object") {
    return false;
  }
  let { meta } = resource;
  if (!("adoptsFrom" in meta) && typeof meta.adoptsFrom !== "object") {
    return false;
  }
  let { adoptsFrom } = meta;
  return (
    "module" in adoptsFrom &&
    typeof adoptsFrom.module === "string" &&
    "name" in adoptsFrom &&
    typeof adoptsFrom.name === "string"
  );
}
export function isCardDocument(doc: any): doc is CardDocument {
  if (typeof doc !== "object") {
    return false;
  }
  return "data" in doc && isCardResource(doc.data);
}

export interface CardDefinition {
  id: CardRef;
  key: string; // this is used to help for JSON-API serialization
  super: CardRef | undefined; // base card has no super
  fields: Map<
    string,
    {
      fieldType: "contains" | "containsMany";
      fieldCard: CardRef;
    }
  >;
}

function hasExecutableExtension(path: string): boolean {
  for (let extension of executableExtensions) {
    if (path.endsWith(extension)) {
      return true;
    }
  }
  return false;
}

function trimExecutableExtension(url: URL): URL {
  for (let extension of executableExtensions) {
    if (url.href.endsWith(extension)) {
      return new URL(url.href.replace(new RegExp(`\\${extension}$`), ""));
    }
  }
  return url;
}

// Forces callers to use URL (which avoids accidentally using relative url
// strings without a base)
class URLMap<T> {
  #map: Map<string, T>;
  constructor(mapTuple: [key: URL, value: T][] = []) {
    this.#map = new Map(mapTuple.map(([key, value]) => [key.href, value]));
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

export class SearchIndex {
  private instances = new URLMap<CardResource>();
  private modules = new URLMap<ModuleSyntax>();
  private definitions = new Map<string, CardDefinition>();
  private exportedCardRefs = new Map<string, CardRef[]>();
  private ignoreMap = new URLMap<Ignore>();

  constructor(
    private realm: Realm,
    private realmPaths: RealmPaths,
    private readdir: (
      path: string
    ) => AsyncGenerator<{ name: string; path: string; kind: Kind }, void>,
    private readFileAsText: (
      path: LocalPath
    ) => Promise<{ content: string; lastModified: number } | undefined>
  ) {}

  async run() {
    await this.visitDirectory(new URL(this.realm.url));
    await this.semanticPhase();
  }

  private async visitDirectory(url: URL): Promise<void> {
    let ignorePatterns = await this.readFileAsText(
      this.realmPaths.local(new URL(".gitignore", url))
    );
    if (ignorePatterns && ignorePatterns.content) {
      this.ignoreMap.set(url, ignore().add(ignorePatterns.content));
    }

    for await (let { path: innerPath, kind } of this.readdir(
      this.realmPaths.local(url)
    )) {
      let innerURL = this.realmPaths.fileURL(innerPath);
      if (this.isIgnored(innerURL)) {
        continue;
      }
      if (kind === "file") {
        await this.visitFile(innerURL);
      } else {
        let directoryURL = this.realmPaths.directoryURL(innerPath);
        await this.visitDirectory(directoryURL);
      }
    }
  }

  async update(url: URL, opts?: { delete?: true }): Promise<void> {
    await this.visitFile(url, opts);
    await this.semanticPhase();
  }

  private async visitFile(url: URL, opts?: { delete?: true }): Promise<void> {
    if (this.isIgnored(url)) {
      return;
    }

    let localPath = this.realmPaths.local(url);
    let fileRef = await this.readFileAsText(localPath);
    if (!fileRef) {
      return;
    }
    let { content, lastModified } = fileRef;
    if (url.href.endsWith(".json")) {
      let json = JSON.parse(content);
      if (isCardDocument(json)) {
        let instanceURL = new URL(url.href.replace(/\.json$/, ""));
        if (opts?.delete && this.instances.get(instanceURL)) {
          this.instances.remove(instanceURL);
        } else {
          json.data.id = instanceURL.href;
          json.data.meta.lastModified = lastModified;
          json.data.searchData = json.data.attributes
            ? flatten(json.data.attributes)
            : {};
          this.instances.set(instanceURL, json.data);
        }
      }
    } else if (
      hasExecutableExtension(url.href) &&
      url.href !== `${baseRealm.url}card-api.gts` // the base card's module is not analyzable
    ) {
      let mod = new ModuleSyntax(content);
      this.modules.set(url, mod);
      this.modules.set(trimExecutableExtension(url), mod);
    }
  }

  private async semanticPhase(): Promise<void> {
    let newDefinitions: Map<string, CardDefinition> = new Map([
      // seed the definitions with the base card
      [
        this.internalKeyFor({
          type: "exportedCard",
          module: `${baseRealm.url}card-api`,
          name: "Card",
        }),
        {
          id: {
            type: "exportedCard",
            module: `${baseRealm.url}card-api`,
            name: "Card",
          },
          key: this.internalKeyFor({
            type: "exportedCard",
            module: `${baseRealm.url}card-api`,
            name: "Card",
          }),
          super: undefined,
          fields: new Map(),
        },
      ],
    ]);
    for (let [url, mod] of this.modules) {
      for (let possibleCard of mod.possibleCards) {
        if (possibleCard.exportedAs) {
          if (this.isIgnored(url)) {
            continue;
          }
          await this.buildDefinition(
            newDefinitions,
            url,
            mod,
            {
              type: "exportedCard",
              module: url.href,
              name: possibleCard.exportedAs,
            },
            possibleCard
          );
        }
      }
    }
    let newExportedCardRefs = new Map<string, CardRef[]>();
    for (let def of newDefinitions.values()) {
      if (def.id.type !== "exportedCard") {
        continue;
      }
      let { module } = def.id;
      let refs = newExportedCardRefs.get(module);
      if (!refs) {
        refs = [];
        newExportedCardRefs.set(module, refs);
      }
      refs.push(def.id);
    }

    // atomically update the search index
    this.definitions = newDefinitions;
    this.exportedCardRefs = newExportedCardRefs;
  }

  private async buildDefinition(
    definitions: Map<string, CardDefinition>,
    url: URL,
    mod: ModuleSyntax,
    ref: CardRef,
    possibleCard: PossibleCardClass
  ): Promise<CardDefinition | undefined> {
    let id: CardRef = possibleCard.exportedAs
      ? {
          type: "exportedCard",
          module: new URL(url, this.realm.url).href,
          name: possibleCard.exportedAs,
        }
      : ref;

    let def = definitions.get(this.internalKeyFor(id));
    if (def) {
      definitions.set(this.internalKeyFor(ref), def);
      return def;
    }

    let superDef = await this.definitionForClassRef(
      definitions,
      url,
      mod,
      possibleCard.super,
      { type: "ancestorOf", card: id }
    );

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
      let fieldDef = await this.definitionForClassRef(
        definitions,
        url,
        mod,
        possibleField.card,
        { type: "fieldOf", card: id, field: fieldName }
      );
      if (fieldDef) {
        fields.set(fieldName, { fieldType, fieldCard: fieldDef.id });
      }
    }

    let key = this.internalKeyFor(id);
    def = { id, key, super: superDef.id, fields };
    definitions.set(key, def);
    return def;
  }

  private async definitionForClassRef(
    definitions: Map<string, CardDefinition>,
    url: URL,
    mod: ModuleSyntax,
    ref: ClassReference,
    targetRef: CardRef
  ): Promise<CardDefinition | undefined> {
    if (ref.type === "internal") {
      return await this.buildDefinition(
        definitions,
        url,
        mod,
        targetRef,
        mod.possibleCards[ref.classIndex]
      );
    } else {
      if (this.isLocal(new URL(ref.module, url))) {
        if (
          baseRealm.fileURL(ref.module).href === `${baseRealm.url}card-api` &&
          ref.name === "Card"
        ) {
          let { module, name } = ref;
          return definitions.get(
            this.internalKeyFor({ module, name, type: "exportedCard" })
          );
        }
        let inner = this.lookupPossibleCard(new URL(ref.module, url), ref.name);
        if (!inner) {
          return undefined;
        }
        return await this.buildDefinition(
          definitions,
          new URL(ref.module, url),
          inner.mod,
          targetRef,
          inner.possibleCard
        );
      } else {
        return await this.getExternalCardDefinition(new URL(ref.module, url), {
          type: "exportedCard",
          name: ref.name,
          module: ref.module,
        });
      }
    }
  }

  private internalKeyFor(ref: CardRef): string {
    switch (ref.type) {
      case "exportedCard":
        let module = new URL(ref.module, this.realm.url).href;
        return `${module}/${ref.name}`;
      case "ancestorOf":
        return `${this.internalKeyFor(ref.card)}/ancestor`;
      case "fieldOf":
        return `${this.internalKeyFor(ref.card)}/fields/${ref.field}`;
    }
  }

  private lookupPossibleCard(
    module: URL,
    exportedName: string
  ): { mod: ModuleSyntax; possibleCard: PossibleCardClass } | undefined {
    let mod = this.modules.get(module);
    if (!mod) {
      // TODO: broken import seems bad
      return undefined;
    }
    let possibleCard = mod.possibleCards.find(
      (c) => c.exportedAs === exportedName
    );
    if (!possibleCard) {
      return undefined;
    }
    return { mod, possibleCard };
  }

  private isLocal(url: URL): boolean {
    return url.href.startsWith(this.realm.url);
  }

  // TODO: complete these types
  async search(query: Query): Promise<CardResource[]> {
    assertQuery(query);

    let cards = [...this.instances.values()];

    if (!query || Object.keys(query).length === 0) {
      return cards;
    }

    let expression: Record<string, any>[] = [];

    if (query.filter) {
      expression = filterToExpression(query.filter);
    }

    return cards.flatMap((card) => (isMatching(expression, card) ? card : []));
  }

  async typeOf(ref: CardRef): Promise<CardDefinition | undefined> {
    return this.definitions.get(this.internalKeyFor(ref));
  }

  async exportedCardsOf(module: string): Promise<CardRef[]> {
    module = new URL(module, this.realm.url).href;
    return this.exportedCardRefs.get(module) ?? [];
  }

  async card(url: URL): Promise<CardResource | undefined> {
    return this.instances.get(url);
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
    let pathname = this.realmPaths.local(url);
    return ignore.test(pathname).ignored;
  }

  private async getExternalCardDefinition(
    moduleURL: URL,
    ref: CardRef
  ): Promise<CardDefinition | undefined> {
    if (!baseRealm.inRealm(moduleURL)) {
      // TODO we need some way to map a module to the realm URL that it comes from
      // so that we now how to ask for it's cards' definitions
      throw new Error(`not implemented`);
    }
    let url = `${this.realm.baseRealmURL}_typeOf?${stringify(ref)}`;
    let response = await fetch(url, {
      headers: {
        Accept: "application/vnd.api+json",
      },
    });
    if (!response.ok) {
      console.log(`Could not get card type for ${url}: ${response.status}`);
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
    return def;
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

function flatten(obj: Record<string, any>): Record<string, any> {
  let result: Record<string, any> = {};
  for (let [key, value] of Object.entries(obj)) {
    if (typeof value === "object") {
      let res = flatten(value);
      for (let [k, val] of Object.entries(res)) {
        result[`${key}.${k}`] = val;
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

function filterToExpression(filter: Filter): Record<string, any>[] {
  if ("every" in filter) {
    return filter.every.flatMap((f) => filterToExpression(f));
  }

  if ("not" in filter) {
    if ("not" in filter.not) {
      return filterToExpression(filter.not.not);
    }
    return filterToExpression(filter.not).map(({ type, fieldPath, value }) => ({
      type: `not ${type}`,
      fieldPath,
      value,
    }));
  }

  if ("eq" in filter) {
    return Object.entries(filter.eq).map(([fieldPath, value]) => ({
      type: `eq`,
      fieldPath,
      value,
    }));
  }

  throw new Error("Unknown filter");
}

function isMatching(
  expressions: Record<string, any>[],
  card: CardResource<string>
): boolean {
  if (!card.searchData) {
    return false;
  }
  for (let expr of expressions) {
    if (expr.type === "eq") {
      if (card.searchData[expr.fieldPath] !== expr.value) {
        return false;
      }
    } else if (expr.type === "not eq") {
      if (card.searchData[expr.fieldPath] === expr.value) {
        return false;
      }
    }
  }
  return true;
}
