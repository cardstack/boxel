import { executableExtensions, baseRealm } from ".";
import { Kind, Realm } from "./realm";
import { CurrentRun, SearchEntry, SearchEntryWithErrors } from "./current-run";
import { LocalPath } from "./paths";
import { Query, Filter, Sort } from "./query";
import flatMap from "lodash/flatMap";
//@ts-ignore realm server TSC doesn't know how to deal with this because it doesn't understand glint
import type { Card } from "https://cardstack.com/base/card-api";
//@ts-ignore realm server TSC doesn't know how to deal with this because it doesn't understand glint
type CardAPI = typeof import("https://cardstack.com/base/card-api");

export type ExportedCardRef = {
  module: string;
  name: string;
};

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

export type Saved = string;
export type Unsaved = string | undefined;
interface CardFields {
  [fieldName: string]: {
    adoptsFrom: {
      module: string;
      name: string;
    };
    fields?: CardFields;
  };
}
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
    fields?: CardFields;
    lastModified?: number;
  };
  links?: {
    self?: string;
  };
}
export interface CardSingleResourceDocument<Identity extends Unsaved = Saved> {
  data: CardResource<Identity>;
}
export interface CardCollectionDocument<Identity extends Unsaved = Saved> {
  data: CardResource<Identity>[];
}

export type CardDocument = CardSingleResourceDocument | CardCollectionDocument;

export function isCardResource(resource: any): resource is CardResource {
  if (typeof resource !== "object") {
    return false;
  }
  if ("id" in resource && typeof resource.id !== "string") {
    return false;
  }
  if ("type" in resource && resource.type !== "card") {
    return false;
  }
  if ("attributes" in resource && typeof resource.attributes !== "object") {
    return false;
  }
  if (!("meta" in resource) || typeof resource.meta !== "object") {
    return false;
  }
  let { meta } = resource;

  if ("fields" in meta) {
    if (!isCardFields(meta.fields)) {
      return false;
    }
  }

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

export function isCardFields(fields: any): fields is CardFields {
  if (typeof fields !== "object") {
    return false;
  }
  for (let [fieldName, field] of Object.entries(
    fields as { [fieldName: string | symbol]: any }
  )) {
    if (
      typeof fieldName !== "string" ||
      typeof field !== "object" ||
      field == null
    ) {
      return false;
    }
    if ("adoptsFrom" in field) {
      let { adoptsFrom } = field;
      if (
        !("module" in adoptsFrom) ||
        typeof adoptsFrom.module !== "string" ||
        !("name" in adoptsFrom) ||
        typeof adoptsFrom.name !== "string"
      ) {
        return false;
      }
    } else {
      return false;
    }
    if ("fields" in field) {
      if (!isCardFields(field.fields)) {
        return false;
      }
    }
  }
  return true;
}

export function isCardDocument(doc: any): doc is CardDocument {
  return isCardSingleResourceDocument(doc) || isCardCollectionDocument(doc);
}

export function isCardSingleResourceDocument(
  doc: any
): doc is CardSingleResourceDocument {
  if (typeof doc !== "object") {
    return false;
  }
  if (!("data" in doc)) {
    return false;
  }
  let { data } = doc;
  if (Array.isArray(data)) {
    return false;
  }
  return isCardResource(data);
}

export function isCardCollectionDocument(
  doc: any
): doc is CardCollectionDocument {
  if (typeof doc !== "object") {
    return false;
  }
  if (!("data" in doc)) {
    return false;
  }
  let { data } = doc;
  if (!Array.isArray(data)) {
    return false;
  }
  return data.every((resource) => isCardResource(resource));
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

export function hasExecutableExtension(path: string): boolean {
  for (let extension of executableExtensions) {
    if (path.endsWith(extension)) {
      return true;
    }
  }
  return false;
}

export function trimExecutableExtension(url: URL): URL {
  for (let extension of executableExtensions) {
    if (url.href.endsWith(extension)) {
      return new URL(url.href.replace(new RegExp(`\\${extension}$`), ""));
    }
  }
  return url;
}

export class SearchIndex {
  #currentRun: CurrentRun;

  constructor(
    private realm: Realm,
    private readdir: (
      path: string
    ) => AsyncGenerator<{ name: string; path: string; kind: Kind }, void>,
    private readFileAsText: (
      path: LocalPath,
      opts?: { withFallbacks?: true }
    ) => Promise<{ content: string; lastModified: number } | undefined>
  ) {
    this.#currentRun = CurrentRun.empty(realm);
  }

  async run() {
    this.#currentRun = await CurrentRun.fromScratch(this.realm, {
      readdir: this.readdir,
      readFileAsText: this.readFileAsText,
    });
  }

  get stats() {
    return this.#currentRun.stats;
  }

  get loader() {
    return this.#currentRun.loader;
  }

  async update(url: URL, opts?: { delete?: true }): Promise<void> {
    this.#currentRun = await CurrentRun.incremental(
      url,
      opts?.delete ? "delete" : "update",
      this.#currentRun
    );
  }

  async search(query: Query): Promise<CardResource[]> {
    let matcher = await this.buildMatcher(query.filter, {
      module: `${baseRealm.url}card-api`,
      name: "Card",
    });

    return flatMap([...this.#currentRun.instances.values()], (maybeError) =>
      maybeError.type !== "error" ? [maybeError.entry] : []
    )
      .filter(matcher)
      .sort(this.buildSorter(query.sort))
      .map((entry) => entry.resource);
  }

  public isIgnored(url: URL): boolean {
    return this.#currentRun.isIgnored(url);
  }

  async typeOf(
    ref: CardRef,
    relativeTo = new URL(this.realm.url)
  ): Promise<CardDefinition | undefined> {
    let result = await this.#currentRun.definitions.get(
      internalKeyFor(ref, relativeTo)
    );
    if (result && result.type !== "error") {
      return result.def;
    }
    if (
      !result &&
      ref.type === "exportedCard" &&
      !this.realm.paths.inRealm(new URL(ref.module, relativeTo))
    ) {
      // we only include external definitions in our definitions cache if we
      // have a card in our realm that uses an external definition. otherwise we
      // should forward requests for external cards to the realm in question
      result = await this.#currentRun.getExternalCardDefinition(ref);
      if (result?.type !== "error") {
        return result?.def;
      }
    }
    return undefined;
  }

  async exportedCardsOf(module: string): Promise<ExportedCardRef[]> {
    let url = trimExecutableExtension(new URL(module, this.realm.url));
    let refsMap = this.#currentRun.exportedCardRefs.get(url);
    if (!refsMap) {
      return [];
    }
    return [...refsMap.values()];
  }

  async card(url: URL): Promise<SearchEntryWithErrors | undefined> {
    return this.#currentRun.instances.get(url);
  }

  // this is meant for tests only
  async searchEntry(url: URL): Promise<SearchEntry | undefined> {
    let result = this.#currentRun.instances.get(url);
    if (result?.type !== "error") {
      return result?.entry;
    }
    return undefined;
  }

  private loadAPI(): Promise<CardAPI> {
    return this.loader.import<CardAPI>(`${baseRealm.url}card-api`);
  }

  private cardHasType(entry: SearchEntry, ref: CardRef): boolean {
    return Boolean(
      entry.types?.find((t) => t === internalKeyFor(ref, undefined)) // assumes ref refers to absolute module URL
    );
  }

  private async getFieldDefinition(
    ref: CardRef,
    fieldSegments: string[]
  ): Promise<CardDefinition | undefined> {
    let def = await this.typeOf(ref);
    if (!def) {
      return undefined;
    }
    let fieldName = fieldSegments.shift()!;
    let fieldDef = def.fields.get(fieldName);
    if (!fieldDef) {
      throw new Error(
        `Your filter refers to nonexistent field "${fieldName}" on type ${internalKeyFor(
          ref,
          undefined // assumes absolute module URL
        )}`
      );
    }
    if (fieldSegments.length > 0) {
      return await this.getFieldDefinition(fieldDef.fieldCard, [
        ...fieldSegments,
      ]);
    }
    return await this.typeOf(fieldDef.fieldCard);
  }

  private async loadFieldCard(
    ref: ExportedCardRef,
    fieldPath: string
  ): Promise<typeof Card> {
    let fieldDef = await this.getFieldDefinition(
      { type: "exportedCard", ...ref },
      fieldPath.split(".")
    );
    if (!fieldDef) {
      throw new Error(
        `Your filter refers to nonexistent type: import ${
          ref.name === "default" ? "default" : `{ ${ref.name} }`
        } from "${ref.module}"`
      );
    }
    if (fieldDef.id.type !== "exportedCard") {
      throw new Error(
        `The field card ${JSON.stringify(
          fieldDef.id
        )} enclosed in ${JSON.stringify(
          ref
        )} with field path "${fieldPath}" is not exported`
      );
    }
    let module = await this.loader.import<Record<string, any>>(
      fieldDef.id.module
    );
    let FieldCard = module[fieldDef.id.name];
    if (!FieldCard) {
      throw new Error(
        `Could not load field card ${JSON.stringify(fieldDef.id)}`
      );
    }
    return FieldCard as typeof Card;
  }

  private buildSorter(
    expressions: Sort | undefined
  ): (e1: SearchEntry, e2: SearchEntry) => number {
    if (!expressions || expressions.length === 0) {
      return () => 0;
    }
    let sorters = expressions.map(({ by, on, direction }) => {
      return (e1: SearchEntry, e2: SearchEntry) => {
        let ref: CardRef = { type: "exportedCard", ...on };
        if (!this.cardHasType(e1, ref)) {
          return direction === "desc" ? -1 : 1;
        }
        if (!this.cardHasType(e2, ref)) {
          return direction === "desc" ? 1 : -1;
        }
        let a = e1.searchData[by];
        let b = e2.searchData[by];
        if (a === undefined) {
          return direction === "desc" ? -1 : 1; // if descending, null position is before the rest
        }
        if (b === undefined) {
          return direction === "desc" ? 1 : -1; // `a` is not null
        }
        if (a < b) {
          return direction === "desc" ? 1 : -1;
        } else if (a > b) {
          return direction === "desc" ? -1 : 1;
        } else {
          return 0;
        }
      };
    });

    return (e1: SearchEntry, e2: SearchEntry) => {
      for (let sorter of sorters) {
        let result = sorter(e1, e2);
        if (result !== 0) {
          return result;
        }
      }
      return 0;
    };
  }

  // Matchers are three-valued (true, false, null) because a query that talks
  // about a field that is not even present on a given card results in `null` to
  // distinguish it from a field that is present but not matching the filter
  // (`false`)
  private async buildMatcher(
    filter: Filter | undefined,
    onRef: ExportedCardRef
  ): Promise<(entry: SearchEntry) => boolean | null> {
    if (!filter) {
      return (_entry) => true;
    }

    if ("type" in filter) {
      let ref: CardRef = { type: "exportedCard", ...filter.type };
      await this.strictTypeOf(ref);
      return (entry) => this.cardHasType(entry, ref);
    }

    let on = filter?.on ?? onRef;

    if ("any" in filter) {
      let matchers = await Promise.all(
        filter.any.map((f) => this.buildMatcher(f, on))
      );
      return (entry) => some(matchers, (m) => m(entry));
    }

    if ("every" in filter) {
      let matchers = await Promise.all(
        filter.every.map((f) => this.buildMatcher(f, on))
      );
      return (entry) => every(matchers, (m) => m(entry));
    }

    if ("not" in filter) {
      let matcher = await this.buildMatcher(filter.not, on);
      return (entry) => {
        let inner = matcher(entry);
        if (inner == null) {
          // irrelevant cards stay irrelevant, even when the query is inverted
          return null;
        } else {
          return !inner;
        }
      };
    }

    if ("eq" in filter) {
      let ref: CardRef = { type: "exportedCard", ...on };

      let fieldCards: { [fieldPath: string]: typeof Card } = Object.fromEntries(
        await Promise.all(
          Object.keys(filter.eq).map(async (fieldPath) => [
            fieldPath,
            await this.loadFieldCard(on, fieldPath),
          ])
        )
      );

      // TODO when we are ready to execute queries within computeds, we'll need to
      // use the loader instance from current-run and not the global loader, as
      // the card definitions may have changed in the current-run loader
      let api = await this.loadAPI();

      return (entry) =>
        every(Object.entries(filter.eq), ([fieldPath, value]) => {
          if (this.cardHasType(entry, ref)) {
            let queryValue = api.getQueryableValue(
              fieldCards[fieldPath]!,
              value
            );
            let instanceValue = entry.searchData[fieldPath];
            if (instanceValue === undefined && queryValue != null) {
              return null;
            }
            // allows queries for null to work
            if (queryValue == null && instanceValue == null) {
              return true;
            }
            return instanceValue === queryValue;
          } else {
            return null;
          }
        });
    }

    if ("range" in filter) {
      let ref: CardRef = { type: "exportedCard", ...on };

      let fieldCards: { [fieldPath: string]: typeof Card } = Object.fromEntries(
        await Promise.all(
          Object.keys(filter.range).map(async (fieldPath) => [
            fieldPath,
            await this.loadFieldCard(on, fieldPath),
          ])
        )
      );

      // TODO when we are ready to execute queries within computeds, we'll need to
      // use the loader instance from current-run and not the global loader, as
      // the card definitions may have changed in the current-run loader
      let api = await this.loadAPI();

      return (entry) =>
        every(Object.entries(filter.range), ([fieldPath, range]) => {
          if (this.cardHasType(entry, ref)) {
            let value = entry.searchData[fieldPath];
            if (value === undefined) {
              return null;
            }

            if (
              (range.gt &&
                !(
                  value >
                  api.getQueryableValue(fieldCards[fieldPath]!, range.gt)
                )) ||
              (range.lt &&
                !(
                  value <
                  api.getQueryableValue(fieldCards[fieldPath]!, range.lt)
                )) ||
              (range.gte &&
                !(
                  value >=
                  api.getQueryableValue(fieldCards[fieldPath]!, range.gte)
                )) ||
              (range.lte &&
                !(
                  value <=
                  api.getQueryableValue(fieldCards[fieldPath]!, range.lte)
                ))
            ) {
              return false;
            }
            return true;
          }
          return null;
        });
    }

    throw new Error("Unknown filter");
  }

  private async strictTypeOf(ref: CardRef): Promise<CardDefinition> {
    let def = await this.typeOf(ref);
    let { module, name } = ref as ExportedCardRef;
    if (!def) {
      throw new Error(
        `Your filter refers to nonexistent type: import ${
          name === "default" ? "default" : `{ ${name} }`
        } from "${module}"`
      );
    }
    return def;
  }
}

export function internalKeyFor(
  ref: CardRef,
  relativeTo: URL | undefined
): string {
  switch (ref.type) {
    case "exportedCard":
      let module = trimExecutableExtension(
        new URL(ref.module, relativeTo)
      ).href;
      return `${module}/${ref.name}`;
    case "ancestorOf":
      return `${internalKeyFor(ref.card, relativeTo)}/ancestor`;
    case "fieldOf":
      return `${internalKeyFor(ref.card, relativeTo)}/fields/${ref.field}`;
  }
}

// three-valued version of Array.every that propagates nulls. Here, the presence
// of any nulls causes the whole thing to be null.
function every<T>(
  list: T[],
  predicate: (t: T) => boolean | null
): boolean | null {
  let result = true;
  for (let element of list) {
    let status = predicate(element);
    if (status == null) {
      return null;
    }
    result = result && status;
  }
  return result;
}

// three-valued version of Array.some that propagates nulls. Here, the whole
// expression becomes null only if the whole input is null.
function some<T>(
  list: T[],
  predicate: (t: T) => boolean | null
): boolean | null {
  let result = null;
  for (let element of list) {
    let status = predicate(element);
    if (status === true) {
      return true;
    }
    if (status === false) {
      result = false;
    }
  }
  return result;
}
