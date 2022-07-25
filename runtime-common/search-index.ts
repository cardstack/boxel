import { executableExtensions, baseRealm } from ".";
import { Kind, Realm } from "./realm";
import { RealmPaths, LocalPath } from "./paths";
import { ModuleSyntax } from "./module-syntax";
import { ClassReference, PossibleCardClass } from "./schema-analysis-plugin";
import ignore, { Ignore } from "ignore";
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
    let ignorePatterns = await this.getIgnorePatterns(url);
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
          this.instances.set(instanceURL, json.data);
        }
      }
    } else if (hasExecutableExtension(url.href)) {
      let mod = new ModuleSyntax(content);
      this.modules.set(url, mod);
      this.modules.set(trimExecutableExtension(url), mod);
    }
  }

  private async semanticPhase(): Promise<void> {
    let newDefinitions: Map<string, CardDefinition> = new Map();
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
        // TODO we should make a fetch to the realm
        return await getExternalCardDefinition(
          new URL(ref.module, url),
          ref.name
        );
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

    if (!query || Object.keys(query).length === 0) {
      return [...this.instances.values()];
    }

    if (query.id) {
      let card = this.instances.get(new URL(query.id));
      return card ? [card] : [];
    }

    if (query.filter) {
      return filterCardData(query.filter, [...this.instances.values()]);
    }

    throw new Error("Not implemented");
  }

  async typeOf(ref: CardRef): Promise<CardDefinition | undefined> {
    return this.definitions.get(this.internalKeyFor(ref));
  }

  async exportedCardsOf(module: string): Promise<CardRef[]> {
    module = new URL(module, this.realm.url).href;
    return this.exportedCardRefs.get(module) ?? [];
  }

  private async getIgnorePatterns(
    url: URL
  ): Promise<{ content: string; lastModified: number } | undefined> {
    let ref = await this.readFileAsText(
      this.realmPaths.local(new URL(".monacoignore", url))
    );
    // are these supposed to be mutually exclusive?
    if (!ref) {
      ref = await this.readFileAsText(
        this.realmPaths.local(new URL(".gitignore", url))
      );
    }

    return ref;
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

export async function getExternalCardDefinition(
  moduleURL: URL,
  exportName: string
): Promise<CardDefinition | undefined> {
  // TODO This is scaffolding for the base realm, implement for real once we
  // have this realm endpoint fleshed out
  if (!baseRealm.inRealm(moduleURL)) {
    return Promise.resolve(undefined);
  }
  let path = baseRealm.local(moduleURL);
  switch (path) {
    case "card-api":
      return exportName === "Card"
        ? {
            id: {
              type: "exportedCard",
              module: moduleURL.href,
              name: exportName,
            },
            key: `${baseRealm.fileURL(path)}/Card`,
            super: undefined,
            fields: new Map(),
          }
        : undefined;
    case "string":
    case "integer":
    case "date":
    case "datetime":
      return exportName === "default"
        ? {
            id: {
              type: "exportedCard",
              module: moduleURL.href,
              name: exportName,
            },
            super: {
              type: "exportedCard",
              module: baseRealm.fileURL("card-api").href,
              name: "Card",
            },
            key: `${baseRealm.fileURL(path)}/default`,
            fields: new Map(),
          }
        : undefined;
    case "text-area":
      return exportName === "default"
        ? Promise.resolve({
            id: {
              type: "exportedCard",
              module: moduleURL.href,
              name: exportName,
            },
            super: {
              type: "exportedCard",
              module: baseRealm.fileURL("string").href,
              name: "default",
            },
            key: `${baseRealm.fileURL(path)}/default`,
            fields: new Map(),
          })
        : undefined;
  }
  throw new Error(
    `unimplemented: don't know how to look up card types for ${moduleURL.href}`
  );
}

function filterCardData(
  filter: Filter,
  results: CardResource[],
  opts?: { negate?: true }
): CardResource[] {
  if (!("not" in filter) && !("eq" in filter)) {
    throw new Error("Not implemented");
  }

  if ("not" in filter) {
    results = filterCardData(filter.not, results, { negate: true });
  }

  if ("eq" in filter) {
    results = filterByFieldData(filter.eq, results, opts);
  }

  return results;
}

function filterByFieldData(
  query: Record<string, any>,
  instances: CardResource[],
  opts?: { negate?: true }
): CardResource[] {
  let results = instances as Record<string, any>[];

  for (let [key, value] of Object.entries(query)) {
    results = results.filter((c) => {
      let fields = key.split(".");
      if (fields.length > 1) {
        let compValue = c;
        while (fields.length > 0 && compValue) {
          let field = fields.shift();
          compValue = compValue?.[field!];
        }
        if (opts?.negate) {
          return compValue !== value;
        }
        return compValue === value;
      } else {
        if (opts?.negate) {
          return c[key] !== value;
        }
        return c[key] === value;
      }
    });
  }

  return results as CardResource[];
}
