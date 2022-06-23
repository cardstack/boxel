import { Realm, executableExtensions } from ".";
import { ModuleSyntax } from "./module-syntax";
import { PossibleCardClass } from "./schema-analysis-plugin";

type CardRef =
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

// TODO
type CardResource = unknown;
type Query = unknown;

interface CardDefinition {
  id: CardRef;
  super: CardRef | undefined; // base card has no super
  // fields: Map<
  //   string,
  //   {
  //     fieldType: "contains" | "containsMany";
  //     fieldCard: CardRef;
  //   }
  // >;
}

function hasExecutableExtension(path: string): boolean {
  for (let extension of executableExtensions) {
    if (path.endsWith(extension)) {
      return true;
    }
  }
  return false;
}

function trimExecutableExtension(path: string): string {
  for (let extension of executableExtensions) {
    if (path.endsWith(extension)) {
      return path.replace(new RegExp(`\\${extension}$`), "");
    }
  }
  return path;
}

export class SearchIndex {
  private instances = new Map<string, CardResource>();
  private modules = new Map<string, ModuleSyntax>();
  private definitions = new Map<string, CardDefinition>();
  private exportedCardRefs = new Map<string, CardRef[]>();

  constructor(private realm: Realm) {}

  async run() {
    for await (let { path, contents } of this.realm.eachFile()) {
      path = new URL(path, this.realm.url).href;
      this.syntacticPhase(path, contents);
    }
    await this.semanticPhase();
  }

  async update(path: string, contents: string): Promise<void> {
    this.syntacticPhase(path, contents);
    await this.semanticPhase();
  }

  private syntacticPhase(path: string, contents: string) {
    if (path.endsWith(".json")) {
      let json = JSON.parse(contents);
      json.data.id = path;
      this.instances.set(path, json);
    } else if (hasExecutableExtension(path)) {
      let mod = new ModuleSyntax(contents);
      this.modules.set(path, mod);
      this.modules.set(trimExecutableExtension(path), mod);
    }
  }

  private async semanticPhase(): Promise<void> {
    let newDefinitions: Map<string, CardDefinition> = new Map();
    for (let [path, mod] of this.modules) {
      for (let possibleCard of mod.possibleCards) {
        if (possibleCard.exportedAs) {
          await this.buildDefinition(
            newDefinitions,
            path,
            mod,
            {
              type: "exportedCard",
              module: path,
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
    path: string,
    mod: ModuleSyntax,
    ref: CardRef,
    possibleCard: PossibleCardClass
  ): Promise<CardDefinition | undefined> {
    let id: CardRef = possibleCard.exportedAs
      ? {
          type: "exportedCard",
          module: new URL(path, this.realm.url).href,
          name: possibleCard.exportedAs,
        }
      : ref;

    let def = definitions.get(this.internalKeyFor(id));
    if (def) {
      definitions.set(this.internalKeyFor(ref), def);
      return def;
    }

    let superDef: CardDefinition | undefined;
    if (possibleCard.super.type === "internal") {
      superDef = await this.buildDefinition(
        definitions,
        path,
        mod,
        { card: id, type: "ancestorOf" },
        mod.possibleCards[possibleCard.super.classIndex]
      );
    } else {
      if (this.isLocal(possibleCard.super.module)) {
        let inner = this.lookupPossibleCard(
          possibleCard.super.module,
          possibleCard.super.name
        );
        if (!inner) {
          return undefined;
        }
        superDef = await this.buildDefinition(
          definitions,
          possibleCard.super.module,
          inner.mod,
          { type: "ancestorOf", card: id },
          inner.possibleCard
        );
      } else {
        superDef = await this.getExternalCardDefinition(
          possibleCard.super.module,
          possibleCard.super.name
        );
      }
    }
    if (!superDef) {
      return undefined;
    }

    def = { id, super: superDef.id };
    definitions.set(this.internalKeyFor(def.id), def);
    return def;
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
    module: string,
    exportedName: string
  ): { mod: ModuleSyntax; possibleCard: PossibleCardClass } | undefined {
    module = new URL(module, this.realm.url).href;
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

  private getExternalCardDefinition(
    url: string,
    exportName: string
  ): Promise<CardDefinition | undefined> {
    // TODO This is scaffolding for the base realm, implement for real once we
    // have this realm endpoint fleshed out
    let module = url.startsWith("http:") ? url : `http:${url}`;
    let moduleURL = new URL(module);
    if (moduleURL.origin !== "http://cardstack.com") {
      return Promise.resolve(undefined);
    }
    let path = moduleURL.pathname;
    switch (path) {
      case "/base/card-api":
        return exportName === "Card"
          ? Promise.resolve({
              id: {
                type: "exportedCard",
                module: url,
                name: exportName,
              },
              super: undefined,
            })
          : Promise.resolve(undefined);
      case "/base/string":
      case "/base/integer":
      case "/base/date":
      case "/base/datetime":
        return exportName === "default"
          ? Promise.resolve({
              id: {
                type: "exportedCard",
                module: url,
                name: exportName,
              },
              super: {
                type: "exportedCard",
                module: "http://cardstack.com/base/card-api",
                name: "Card",
              },
            })
          : Promise.resolve(undefined);
      case "/base/text-area":
        return exportName === "default"
          ? Promise.resolve({
              id: {
                type: "exportedCard",
                module: url,
                name: exportName,
              },
              super: {
                type: "exportedCard",
                module: "http://cardstack.com/base/string",
                name: "default",
              },
            })
          : Promise.resolve(undefined);
    }
    throw new Error(
      `unimplemented: don't know how to look up card types for ${url}`
    );
  }

  private isLocal(url: string): boolean {
    return new URL(url, this.realm.url).href.startsWith(this.realm.url);
  }

  // TODO: complete these types
  async search(_query: Query): Promise<CardResource[]> {
    return [...this.instances.values()];
  }

  async typeOf(ref: CardRef): Promise<CardDefinition | undefined> {
    return this.definitions.get(this.internalKeyFor(ref));
  }

  async exportedCardsOf(module: string): Promise<CardRef[]> {
    module = new URL(module, this.realm.url).href;
    return this.exportedCardRefs.get(module) ?? [];
  }
}
