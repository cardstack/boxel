import { baseRealm, internalKeyFor, LooseCardResource, maxLinkDepth } from ".";
import { Kind, Realm } from "./realm";
import { CurrentRun, SearchEntry } from "./current-run";
import { LocalPath } from "./paths";
import { Query, Filter, Sort } from "./query";
import { CardError, type SerializedError } from "./error";
import flatMap from "lodash/flatMap";
import { Card } from "https://cardstack.com/base/card-api";
import type * as CardAPI from "https://cardstack.com/base/card-api";
import {
  type CardRef,
  getField,
  identifyCard,
  loadCard,
  isCardRef,
} from "./card-ref";

export type Saved = string;
export type Unsaved = string | undefined;
export interface Meta {
  adoptsFrom: CardRef;
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
    related?: string | null;
  };
  data?: ResourceID | ResourceID[] | null;
  meta?: Record<string, any>;
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
  return isCardRef(adoptsFrom);
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
    if (!isCardRef(adoptsFrom)) {
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
  if ("meta" in relationship && typeof relationship.meta !== "object") {
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
    if ("related" in links) {
      if (typeof links.related !== "string" && links.related !== null) {
        return false;
      }
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

interface Options {
  loadLinks?: true;
}

type SearchResult = SearchResultDoc | SearchResultError;
interface SearchResultDoc {
  type: "doc";
  doc: SingleCardDocument;
}
interface SearchResultError {
  type: "error";
  error: SerializedError;
}

export class SearchIndex {
  #currentRun: CurrentRun;

  constructor(
    private realm: Realm,
    readdir: (
      path: string
    ) => AsyncGenerator<{ name: string; path: string; kind: Kind }, void>,
    readFileAsText: (
      path: LocalPath,
      opts?: { withFallbacks?: true }
    ) => Promise<{ content: string; lastModified: number } | undefined>
  ) {
    this.#currentRun = new CurrentRun({
      realm,
      reader: { readdir, readFileAsText },
    });
  }

  async run() {
    await CurrentRun.fromScratch(this.#currentRun);
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

  async search(query: Query, opts?: Options): Promise<CardCollectionDocument> {
    let matcher = await this.buildMatcher(query.filter, {
      module: `${baseRealm.url}card-api`,
      name: "Card",
    });

    let doc: CardCollectionDocument = {
      data: flatMap([...this.#currentRun.instances.values()], (maybeError) =>
        maybeError.type !== "error" ? [maybeError.entry] : []
      )
        .filter(matcher)
        .sort(this.buildSorter(query.sort))
        .map((entry) => ({
          ...entry.resource,
          ...{ links: { self: entry.resource.id } },
        })),
    };

    let omit = doc.data.map((r) => r.id);
    if (opts?.loadLinks) {
      let included: CardResource<Saved>[] = [];
      for (let resource of doc.data) {
        included = await this.loadLinks(resource, omit, included);
      }
      if (included.length > 0) {
        doc.included = included;
      }
    }

    return doc;
  }

  public isIgnored(url: URL): boolean {
    return this.#currentRun.isIgnored(url);
  }

  async card(url: URL, opts?: Options): Promise<SearchResult | undefined> {
    let card = this.#currentRun.instances.get(url);
    if (!card) {
      return undefined;
    }
    if (card.type === "error") {
      return card;
    }
    let doc: SingleCardDocument = {
      data: { ...card.entry.resource, ...{ links: { self: url.href } } },
    };
    if (opts?.loadLinks) {
      let included = await this.loadLinks(doc.data, [doc.data.id]);
      if (included.length > 0) {
        doc.included = included;
      }
    }
    return { type: "doc", doc };
  }

  // TODO The caller should provide a list of fields to be included via JSONAPI
  // request. currently we just use the maxLinkDepth to control how deep to load
  // links
  async loadLinks(
    resource: LooseCardResource,
    omit: string[] = [],
    included: CardResource<Saved>[] = [],
    visited: string[] = [],
    stack: string[] = []
  ): Promise<CardResource<Saved>[]> {
    if (resource.id != null) {
      if (visited.includes(resource.id)) {
        return [];
      }
      visited.push(resource.id);
    }

    for (let [fieldName, relationship] of Object.entries(
      resource.relationships ?? {}
    )) {
      if (!relationship.links.self) {
        continue;
      }
      let linkURL = new URL(relationship.links.self);
      let linkResource: CardResource<Saved> | undefined;
      if (this.realm.paths.inRealm(linkURL)) {
        let maybeEntry = this.#currentRun.instances.get(
          new URL(relationship.links.self)
        );
        linkResource =
          maybeEntry?.type === "entry" ? maybeEntry.entry.resource : undefined;
      } else {
        let response = await this.loader.fetch(linkURL, {
          headers: { Accept: "application/vnd.api+json" },
        });
        if (!response.ok) {
          let cardError = await CardError.fromFetchResponse(
            linkURL.href,
            response
          );
          throw cardError;
        }
        let json = await response.json();
        if (!isSingleCardDocument(json)) {
          throw new Error(
            `instance ${
              linkURL.href
            } is not a card document. it is: ${JSON.stringify(json, null, 2)}`
          );
        }
        linkResource = { ...json.data, ...{ links: { self: json.data.id } } };
      }
      let foundLinks = false;
      if (linkResource && stack.length <= maxLinkDepth) {
        for (let includedResource of await this.loadLinks(
          linkResource,
          omit,
          [...included, linkResource],
          visited,
          [...(resource.id != null ? [resource.id] : []), ...stack]
        )) {
          foundLinks = true;
          if (
            !omit.includes(includedResource.id) &&
            !included.find((r) => r.id === includedResource.id)
          ) {
            included.push({
              ...includedResource,
              ...{ links: { self: includedResource.id } },
            });
          }
        }
      }
      if (foundLinks || omit.includes(relationship.links.self)) {
        resource.relationships![fieldName].data = {
          type: "card",
          id: relationship.links.self,
        };
      }
    }
    return included;
  }

  // this is meant for tests only
  async searchEntry(url: URL): Promise<SearchEntry | undefined> {
    let result = this.#currentRun.instances.get(url);
    if (result?.type !== "error") {
      return result?.entry;
    }
    return undefined;
  }

  private loadAPI(): Promise<typeof CardAPI> {
    return this.loader.import<typeof CardAPI>(`${baseRealm.url}card-api`);
  }

  private cardHasType(entry: SearchEntry, ref: CardRef): boolean {
    return Boolean(
      entry.types?.find((t) => t === internalKeyFor(ref, undefined)) // assumes ref refers to absolute module URL
    );
  }

  private async loadFieldCard(
    ref: CardRef,
    fieldPath: string
  ): Promise<typeof Card> {
    let card: typeof Card | undefined;
    try {
      card = await loadCard(ref, { loader: this.loader });
    } catch (err: any) {
      if (!("type" in ref)) {
        throw new Error(
          `Your filter refers to nonexistent type: import ${
            ref.name === "default" ? "default" : `{ ${ref.name} }`
          } from "${ref.module}"`
        );
      } else {
        throw new Error(
          `Your filter refers to nonexistent type: ${JSON.stringify(
            ref,
            null,
            2
          )}`
        );
      }
    }
    if (!card) {
      throw new Error(
        `A card was not found for type: ${JSON.stringify(ref, null, 2)}`
      );
    }
    let segments = fieldPath.split(".");
    while (segments.length) {
      let fieldName = segments.shift()!;
      let prevCard = card;
      card = getField(card, fieldName)?.card;
      if (!card) {
        throw new Error(
          `Your filter refers to nonexistent field "${fieldName}" on type ${JSON.stringify(
            identifyCard(prevCard)
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
        if (!this.cardHasType(e1, on)) {
          return direction === "desc" ? -1 : 1;
        }
        if (!this.cardHasType(e2, on)) {
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
    onRef: CardRef
  ): Promise<(entry: SearchEntry) => boolean | null> {
    if (!filter) {
      return (_entry) => true;
    }

    if ("type" in filter) {
      return (entry) => this.cardHasType(entry, filter.type);
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
      let ref: CardRef = on;

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
      let ref: CardRef = on;

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
  let result: boolean | null = null;
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
