import { Realm } from ".";
import { ModuleSyntax } from "./module-syntax";

// TODO
type CardResource = unknown;
type Query = unknown;
type CardDefinition = unknown;

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
            possibleCard.super.module
          );
          let theirDef = theirDefinitions.get(possibleCard.super.name);
          if (!theirDef) {
            // the export isn't a card
            continue;
          }
          // NEXT TODO: our possibleCard is indeed a card that extends from theirDef. So we
          // need to build our definition for it and make sure it goes into
          // ourDefinitions.
        } else {
          // ask remote realm here. Initially, hard code base realm answers and
          // treat everything else as not a realm, so return no answer.
        }
      } else {
        // lookup our previous work above for the possibleCard we extend, then
        // build our definition off it as before
      }
    }
    return ourDefinitions;
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
