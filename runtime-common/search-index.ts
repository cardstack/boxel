import { baseRealm, internalKeyFor } from ".";
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
export interface Meta {
  adoptsFrom: ExportedCardRef;
  fields?: CardFields;
}
export interface CardFields {
  [fieldName: string]: Partial<Meta> | Partial<Meta>[];
}

interface ResourceID {
  type: string;
  id: string;
}

export type Relationship = {
  links: {
    // there are other valid items for links in the spec, but we don't
    // anticipate using them
    self: string | null;
  };
  data?: ResourceID | ResourceID[] | null;
};

export interface CardResource<Identity extends Unsaved = Saved> {
  id: Identity;
  type: "card";
  attributes?: Record<string, any>;
  relationships?: {
    [fieldName: string]: Relationship;
  };
  meta: Meta & {
    lastModified?: number;
  };
  links?: {
    self?: string;
  };
}
export interface SingleCardDocument<Identity extends Unsaved = Saved> {
  data: CardResource<Identity>;
  included?: CardResource<Saved>[];
}
export interface CardCollectionDocument<Identity extends Unsaved = Saved> {
  data: CardResource<Identity>[];
  included?: CardResource<Saved>[];
}

export type CardDocument = SingleCardDocument | CardCollectionDocument;

export function isCardResource(resource: any): resource is CardResource {
  if (typeof resource !== "object" || resource == null) {
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
  if ("relationships" in resource) {
    let { relationships } = resource;
    if (typeof relationships !== "object" || relationships == null) {
      return false;
    }
    for (let [fieldName, relationship] of Object.entries(relationships)) {
      if (typeof fieldName !== "string") {
        return false;
      }
      if (!isRelationship(relationship)) {
        return false;
      }
    }
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
  for (let [fieldName, fieldItem] of Object.entries(
    fields as { [fieldName: string | symbol]: any }
  )) {
    if (typeof fieldName !== "string") {
      return false;
    }
    if (Array.isArray(fieldItem)) {
      if (fieldItem.some((f) => !isMeta(f, true))) {
        return false;
      }
    } else if (!isMeta(fieldItem, true)) {
      return false;
    }
  }
  return true;
}

export function isMeta(meta: any, allowPartial: true): meta is Partial<Meta>;
export function isMeta(meta: any): meta is Meta;
export function isMeta(meta: any, allowPartial = false) {
  if (typeof meta !== "object" || meta == null) {
    return false;
  }
  if ("adoptsFrom" in meta) {
    let { adoptsFrom } = meta;
    if (
      !("module" in adoptsFrom) ||
      typeof adoptsFrom.module !== "string" ||
      !("name" in adoptsFrom) ||
      typeof adoptsFrom.name !== "string"
    ) {
      return false;
    }
  } else {
    if (!allowPartial) {
      return false;
    }
  }
  if ("fields" in meta) {
    if (!isCardFields(meta.fields)) {
      return false;
    }
  }
  return true;
}

export function isRelationship(
  relationship: any
): relationship is Relationship {
  if (typeof relationship !== "object" || relationship == null) {
    return false;
  }
  if ("links" in relationship) {
    let { links } = relationship;
    if (typeof links !== "object" || links == null) {
      return false;
    }
    if (!("self" in links)) {
      return false;
    }
    let { self } = links;
    if (typeof self !== "string" && self !== null) {
      return false;
    }
  } else if ("data" in relationship) {
    let { data } = relationship;
    if (typeof data !== "object") {
      return false;
    }
    if (data !== null && "type" in data && "id" in data) {
      let { type, id } = data;
      if (typeof type !== "string" || typeof id !== "string") {
        return false;
      }
    }
  } else {
    return false;
  }
  return true;
}

export function isCardDocument(doc: any): doc is CardDocument {
  return isSingleCardDocument(doc) || isCardCollectionDocument(doc);
}

export function isSingleCardDocument(doc: any): doc is SingleCardDocument {
  if (typeof doc !== "object" || doc == null) {
    return false;
  }
  if (!("data" in doc)) {
    return false;
  }
  let { data } = doc;
  if (Array.isArray(data)) {
    return false;
  }
  if ("included" in doc) {
    let { included } = doc;
    if (!isIncluded(included)) {
      return false;
    }
  }
  return isCardResource(data);
}

export function isCardCollectionDocument(
  doc: any
): doc is CardCollectionDocument {
  if (typeof doc !== "object" || doc == null) {
    return false;
  }
  if (!("data" in doc)) {
    return false;
  }
  let { data } = doc;
  if (!Array.isArray(data)) {
    return false;
  }
  if ("included" in doc) {
    let { included } = doc;
    if (!isIncluded(included)) {
      return false;
    }
  }
  return data.every((resource) => isCardResource(resource));
}

function isIncluded(included: any): included is CardResource<Saved>[] {
  if (!Array.isArray(included)) {
    return false;
  }
  for (let resource of included) {
    if (typeof resource !== "object" || !resource) {
      return false;
    }
    if (!("id" in resource) || typeof resource.id !== "string") {
      return false;
    }
    if (!isCardResource(resource)) {
      return false;
    }
  }
  return true;
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

  private async loadFieldCard(
    ref: ExportedCardRef,
    fieldPath: string
  ): Promise<typeof Card> {
    let api = await this.loadAPI();
    let module: Record<string, typeof Card>;
    try {
      module = await this.loader.import<Record<string, typeof Card>>(
        ref.module
      );
    } catch (err: any) {
      throw new Error(
        `Your filter refers to nonexistent type: import ${
          ref.name === "default" ? "default" : `{ ${ref.name} }`
        } from "${ref.module}"`
      );
    }
    let card: typeof Card | undefined = module[ref.name];
    let segments = fieldPath.split(".");
    while (segments.length) {
      let fieldName = segments.shift()!;
      let prevCard = card;
      card = (await api.getField(card, fieldName))?.card;
      if (!card) {
        throw new Error(
          `Your filter refers to nonexistent field "${fieldName}" on type ${JSON.stringify(
            this.loader.identify(prevCard)
          )}`
        );
      }
    }
    return card;
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
