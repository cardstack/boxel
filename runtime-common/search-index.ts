import { Realm } from ".";
import { ModuleSyntax } from "./module-syntax";

// TODO
type CardResource = unknown;
type Query = unknown;
interface CardDefinition {
  id: { module: string; name: string };
  adoptionChain: { module: string; name: string }[];
  fields: Map<
    string,
    {
      fieldType: "contains" | "containsMany";
      fieldCard: { module: string; name: string };
    }
  >;
}

const base = "//cardstack.com/base/";
export class SearchIndex {
  private instances = new Map<string, CardResource>();
  private modules = new Map<string, ModuleSyntax>();
  private definitions = new Map<string, Map<string, CardDefinition>>();

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
    }
  }

  private async semanticPhase(): Promise<void> {
    let newDefinitions: Map<string, Map<string, CardDefinition>> = new Map();
    for (let path of this.modules.keys()) {
      await this.buildDefinitions(newDefinitions, path);
    }
    this.definitions = newDefinitions;
  }

  private async buildDefinitions(
    definitions: Map<string, Map<string, CardDefinition>>,
    path: string
  ): Promise<Map<string, CardDefinition>> {
    let ourDefinitions = definitions.get(path);
    if (ourDefinitions) {
      return ourDefinitions;
    }
    ourDefinitions = new Map();
    definitions.set(path, ourDefinitions);
    let mod = this.modules.get(path);
    if (!mod) {
      console.warn(`TODO: do something to inform people about a broken link`);
      return ourDefinitions;
    }
    for (let possibleCard of mod.possibleCards) {
      if (possibleCard.super.type === "external") {
        if (this.isLocal(possibleCard.super.module)) {
          let theirDefinitions = await this.buildDefinitions(
            definitions,
            new URL(possibleCard.super.module, this.realm.url).href // TODO: module name might contain extension
          );
          let theirDef = theirDefinitions.get(possibleCard.super.name);
          if (!theirDef) {
            // the export isn't a card
            continue;
          }
          if (!possibleCard.exportedAs) {
            // the card is not exported, hence it is not possible to use
            // directly, so it probably shouldn't appear in search results
            continue;
          }
          ourDefinitions.set(possibleCard.exportedAs, {
            id: {
              module: new URL(path, this.realm.url).href,
              name: possibleCard.exportedAs,
            },
            adoptionChain: [theirDef.id, ...theirDef.adoptionChain],

            //TODO use the same or similar logic to ascertain the field cards
            //from the possibleCard.possibleFields Map
            fields: new Map(),
          });
        } else {
          // ask remote realm here. Initially, hard code base realm answers and
          // treat everything else as not a realm, so return no answer.
          let adoptionChain = await this.getExternalRealmCardType(
            possibleCard.super.module,
            possibleCard.super.name
          );
          if (!adoptionChain) {
            // the export isn't a card
            continue;
          }
          if (!possibleCard.exportedAs) {
            // the card is not exported, hence it is not possible to use
            // directly, so it probably shouldn't appear in search results
            continue;
          }
          ourDefinitions.set(possibleCard.exportedAs, {
            id: {
              module: new URL(path, this.realm.url).href,
              name: possibleCard.exportedAs,
            },
            adoptionChain,

            //TODO use the same or similar logic to ascertain the field cards
            //from the possibleCard.possibleFields Map
            fields: new Map(),
          });
        }
      } else {
        // lookup our previous work above for the possibleCard we extend, then
        // build our definition off it as before
      }
    }
    return ourDefinitions;
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
      let path = new URL(module).pathname;
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
