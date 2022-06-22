import { Realm } from ".";
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
  super: CardRef;
  // fields: Map<
  //   string,
  //   {
  //     fieldType: "contains" | "containsMany";
  //     fieldCard: CardRef;
  //   }
  // >;
}

function internalKeyFor(ref: CardRef): string {
  switch (ref.type) {
    case "exportedCard":
      return `${ref.module}/${ref.name}`;
    case "ancestorOf":
      return `${internalKeyFor(ref.card)}/ancestor`;
    case "fieldOf":
      return `${internalKeyFor(ref.card)}/fields/${ref.field}`;
  }
}

const base = "//cardstack.com/base/";
export class SearchIndex {
  private instances = new Map<string, CardResource>();
  private modules = new Map<string, ModuleSyntax>();
  private definitions = new Map<string, CardDefinition>();

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
    } else if (path.endsWith(".gts")) {
      // TODO: make a shared list of executable extensions
      this.modules.set(path, new ModuleSyntax(contents));
      // TODO also add entry for path without extension since the extension is optional for import specifiers
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
          module: path,
          name: possibleCard.exportedAs,
        }
      : ref;

    let def = definitions.get(internalKeyFor(id));
    if (def) {
      definitions.set(internalKeyFor(ref), def);
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
        // todo: lookup external realm
        return undefined;
      }
    }
    if (!superDef) {
      return undefined;
    }

    def = { id, super: superDef.id };
    this.definitions.set(internalKeyFor(def.id), def);
    return def;
  }

  private lookupPossibleCard(
    module: string,
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

  // This returns the adoption chain, which is an array of card ID objects
  private getExternalRealmCardType(
    url: string,
    exportName: string
  ): Promise<{ module: string; name: string }[] | undefined> {
    // TODO This is scaffolding for the base realm, implement for real once we
    // have this realm endpoint fleshed out
    if (url.startsWith(base)) {
      let chain = [
        { module: "http://cardstack.com/base/card-api", name: "Card" },
      ];
      let module = url.startsWith("http:") ? url : `http:${url}`;
      let moduleURL = new URL(module);
      if (moduleURL.origin !== "http://cardstack.com") {
        return Promise.resolve(undefined);
      }
      let path = moduleURL.pathname;
      switch (path) {
        case "/base/card-api":
          return exportName === "Card"
            ? Promise.resolve(chain)
            : Promise.resolve(undefined);
        case "/base/string":
        case "/base/integer":
        case "/base/date":
        case "/base/datetime":
          return exportName === "default"
            ? Promise.resolve([{ module, name: "default" }, ...chain])
            : Promise.resolve(undefined);
        case "/base/text-area":
          return exportName === "default"
            ? Promise.resolve([
                { module, name: "default" },
                { module: "http://cardstack.com/base/string", name: "default" },
                ...chain,
              ])
            : Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
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

  // TODO: complete these types
  async typeOf(
    path: string,
    exportName: string
  ): Promise<CardDefinition | undefined> {
    path = new URL(path, this.realm.url).href;
    let mod = this.definitions.get(path);
    return mod?.get(exportName);
  }
}
