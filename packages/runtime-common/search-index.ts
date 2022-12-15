import { baseRealm, internalKeyFor } from ".";
import { Kind, Realm } from "./realm";
import { CurrentRun, SearchEntry } from "./current-run";
import { LocalPath } from "./paths";
import { Query, Filter, Sort } from "./query";
import { type SerializedError } from "./error";
import flatMap from "lodash/flatMap";
import { Card } from "https://cardstack.com/base/card-api";
import type * as CardAPI from "https://cardstack.com/base/card-api";
import { type CardRef, getField, identifyCard, loadCard } from "./card-ref";
import {
  type SingleCardDocument,
  type CardCollectionDocument,
  type CardResource,
  type Saved,
} from "./card-document";

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
    realm: Realm,
    readdir: (
      path: string
    ) => AsyncGenerator<{ name: string; path: string; kind: Kind }, void>,
    readFileAsText: (
      path: LocalPath,
      opts?: { withFallbacks?: true }
    ) => Promise<{ content: string; lastModified: number } | undefined>,
    getVisitor?: (_fetch: typeof fetch) => (url: string) => Promise<string>
  ) {
    this.#currentRun = new CurrentRun({
      realm,
      reader: { readdir, readFileAsText },
      getVisitor,
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
        included = await this.#currentRun.loadLinks(resource, omit, included);
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
      let included = await this.#currentRun.loadLinks(doc.data, [doc.data.id]);
      if (included.length > 0) {
        doc.included = included;
      }
    }
    return { type: "doc", doc };
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
