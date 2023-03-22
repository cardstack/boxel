import {
  maxLinkDepth,
  baseRealm,
  internalKeyFor,
  type LooseCardResource,
} from '.';
import { Kind, Realm } from './realm';
import { LocalPath, RealmPaths } from './paths';
import { Loader } from './loader';
import type { Query, Filter, Sort, EqFilter } from './query';
import { CardError, type SerializedError } from './error';
import { URLMap } from './url-map';
import flatMap from 'lodash/flatMap';
import ignore, { type Ignore } from 'ignore';
import type { Card } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import { type CardRef, getField, identifyCard, loadCard } from './card-ref';
import {
  isSingleCardDocument,
  type SingleCardDocument,
  type CardCollectionDocument,
  type CardResource,
  type Saved,
} from './card-document';

export interface Reader {
  readFileAsText: (
    path: LocalPath,
    opts?: { withFallbacks?: true }
  ) => Promise<{ content: string; lastModified: number } | undefined>;
  readdir: (
    path: string
  ) => AsyncGenerator<{ name: string; path: string; kind: Kind }, void>;
}

export interface Stats {
  instancesIndexed: number;
  instanceErrors: number;
  moduleErrors: number;
}

export interface RunState {
  realmURL: URL;
  instances: URLMap<SearchEntryWithErrors>;
  ignoreMap: URLMap<Ignore>;
  ignoreMapContents: URLMap<string>;
  modules: Map<string, ModuleWithErrors>;
  stats: Stats;
}

export interface SerializableRunState {
  realmURL: string;
  instances: [string, SearchEntryWithErrors][];
  ignoreMap: [string, string][];
  modules: [string, ModuleWithErrors][];
  stats: Stats;
}

export type RunnerRegistration = (
  fromScratch: (realmURL: URL) => Promise<RunState>,
  incremental: (
    prev: RunState,
    url: URL,
    operation: 'update' | 'delete'
  ) => Promise<RunState>
) => Promise<void>;

export type EntrySetter = (url: URL, entry: SearchEntryWithErrors) => void;

export interface RunnerOpts {
  _fetch: typeof fetch;
  reader: Reader;
  entrySetter: EntrySetter;
  registerRunner: RunnerRegistration;
}
export type IndexRunner = (optsId: number) => Promise<void>;

export interface SearchEntry {
  resource: CardResource;
  searchData: Record<string, any>;
  html?: string; // we don't have this until after the indexer route is rendered...
  types: string[];
  deps: Set<string>;
}

export type SearchEntryWithErrors =
  | { type: 'entry'; entry: SearchEntry }
  | { type: 'error'; error: SerializedError };

export interface Module {
  url: string;
  consumes: string[];
}
export type ModuleWithErrors =
  | { type: 'module'; module: Module }
  | { type: 'error'; moduleURL: string; error: SerializedError };

interface Options {
  loadLinks?: true;
}

type SearchResult = SearchResultDoc | SearchResultError;
interface SearchResultDoc {
  type: 'doc';
  doc: SingleCardDocument;
}
interface SearchResultError {
  type: 'error';
  error: SerializedError;
}

type CurrentIndex = RunState & {
  loader: Loader;
};

// This class is used to support concurrent index runs against the same fastboot
// instance. While each index run calls visit on the fastboot instance and has
// its own memory space, the globals that are passed into fastboot are shared.
// This global is what holds loader context (specifically the loader fetch) and
// index mutators for the fastboot instance. each index run will have a
// different loader fetch and its own index mutator. in order to keep these from
// colliding during concurrent indexing we hold each set of fastboot globals in
// a map that is unique for the index run. When the server visits fastboot it
// will provide the indexer route with the id for the fastboot global that is
// specific to the index run.
let optsId = 0;
export class RunnerOptionsManager {
  #opts = new Map<number, RunnerOpts>();
  setOptions(opts: RunnerOpts): number {
    let id = optsId++;
    this.#opts.set(id, opts);
    return id;
  }
  getOptions(id: number): RunnerOpts {
    let opts = this.#opts.get(id);
    if (!opts) {
      throw new Error(`No runner opts for id ${id}`);
    }
    return opts;
  }
  removeOptions(id: number) {
    this.#opts.delete(id);
  }
}

export class SearchIndex {
  #runner: IndexRunner;
  runnerOptsMgr: RunnerOptionsManager;
  #reader: Reader;
  #index: CurrentIndex;
  #fromScratch: ((realmURL: URL) => Promise<RunState>) | undefined;
  #incremental:
    | ((
        prev: RunState,
        url: URL,
        operation: 'update' | 'delete'
      ) => Promise<RunState>)
    | undefined;

  constructor(
    realm: Realm,
    readdir: (
      path: string
    ) => AsyncGenerator<{ name: string; path: string; kind: Kind }, void>,
    readFileAsText: (
      path: LocalPath,
      opts?: { withFallbacks?: true }
    ) => Promise<{ content: string; lastModified: number } | undefined>,
    runner: IndexRunner,
    runnerOptsManager: RunnerOptionsManager
  ) {
    this.#reader = { readdir, readFileAsText };
    this.runnerOptsMgr = runnerOptsManager;
    this.#runner = runner;
    this.#index = {
      realmURL: new URL(realm.url),
      loader: Loader.createLoaderFromGlobal(),
      ignoreMap: new URLMap(),
      ignoreMapContents: new URLMap(),
      instances: new URLMap(),
      modules: new Map(),
      stats: {
        instancesIndexed: 0,
        instanceErrors: 0,
        moduleErrors: 0,
      },
    };
  }

  get stats() {
    return this.#index.stats;
  }

  get loader() {
    return this.#index.loader;
  }

  get runState() {
    return this.#index;
  }

  async run() {
    await this.setupRunner(async () => {
      if (!this.#fromScratch) {
        throw new Error(`Index runner has not been registered`);
      }
      let current = await this.#fromScratch(this.#index.realmURL);
      this.#index = {
        ...this.#index, // don't clobber the instances that the entrySetter has already made
        modules: current.modules,
        ignoreMap: current.ignoreMap,
        realmURL: current.realmURL,
        stats: current.stats,
        loader: Loader.createLoaderFromGlobal(),
      };
    });
  }

  async update(url: URL, opts?: { delete?: true }): Promise<void> {
    await this.setupRunner(async () => {
      if (!this.#incremental) {
        throw new Error(`Index runner has not been registered`);
      }
      let current = await this.#incremental(
        this.#index,
        url,
        opts?.delete ? 'delete' : 'update'
      );
      this.#index = {
        // we overwrite the instances in the incremental update, as there may
        // have been instance removals due to invalidation that the entrySetter
        // cannot accommodate in its current form
        instances: current.instances,
        modules: current.modules,
        ignoreMap: current.ignoreMap,
        ignoreMapContents: current.ignoreMapContents,
        realmURL: current.realmURL,
        stats: current.stats,
        loader: Loader.createLoaderFromGlobal(),
      };
    });
  }

  private async setupRunner(start: () => Promise<void>) {
    let optsId = this.runnerOptsMgr.setOptions({
      _fetch: this.loader.fetch.bind(this.loader),
      reader: this.#reader,
      entrySetter: (url, entry) => {
        this.#index.instances.set(url, entry);
      },
      registerRunner: async (fromScratch, incremental) => {
        this.#fromScratch = fromScratch;
        this.#incremental = incremental;
        await start();
      },
    });
    await this.#runner(optsId);
    this.runnerOptsMgr.removeOptions(optsId);
  }

  async search(query: Query, opts?: Options): Promise<CardCollectionDocument> {
    let matcher = await this.buildMatcher(query.filter, {
      module: `${baseRealm.url}card-api`,
      name: 'Card',
    });

    let doc: CardCollectionDocument = {
      data: flatMap([...this.#index.instances.values()], (maybeError) =>
        maybeError.type !== 'error' ? [maybeError.entry] : []
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
        included = await loadLinks({
          realmURL: this.#index.realmURL,
          instances: this.#index.instances,
          loader: this.loader,
          resource,
          omit,
          included,
        });
      }
      if (included.length > 0) {
        doc.included = included;
      }
    }

    return doc;
  }

  public isIgnored(url: URL): boolean {
    return isIgnored(this.#index.realmURL, this.#index.ignoreMap, url);
  }

  async card(url: URL, opts?: Options): Promise<SearchResult | undefined> {
    let card = this.#index.instances.get(url);
    if (!card) {
      return undefined;
    }
    if (card.type === 'error') {
      return card;
    }
    let doc: SingleCardDocument = {
      data: { ...card.entry.resource, ...{ links: { self: url.href } } },
    };
    if (opts?.loadLinks) {
      let included = await loadLinks({
        realmURL: this.#index.realmURL,
        instances: this.#index.instances,
        loader: this.loader,
        resource: doc.data,
        omit: [doc.data.id],
      });
      if (included.length > 0) {
        doc.included = included;
      }
    }
    return { type: 'doc', doc };
  }

  // this is meant for tests only
  async searchEntry(url: URL): Promise<SearchEntry | undefined> {
    let result = this.#index.instances.get(url);
    if (result?.type !== 'error') {
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
      if (!('type' in ref)) {
        throw new Error(
          `Your filter refers to nonexistent type: import ${
            ref.name === 'default' ? 'default' : `{ ${ref.name} }`
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
    let segments = fieldPath.split('.');
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

  private getFieldData(searchData: Record<string, any>, fieldPath: string) {
    let data = searchData;
    let segments = fieldPath.split('.');
    while (segments.length && data != null) {
      let fieldName = segments.shift()!;
      data = data[fieldName];
      // if (Array.isArray(data) && segments.length) {
      //   data = data.map((v) => this.getFieldData(v, segments.join('.')));
      //   return data;
      // }
    }
    return data;
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
          return direction === 'desc' ? -1 : 1;
        }
        if (!this.cardHasType(e2, on)) {
          return direction === 'desc' ? 1 : -1;
        }

        let a = this.getFieldData(e1.searchData, by);
        let b = this.getFieldData(e2.searchData, by);
        if (a === undefined) {
          return direction === 'desc' ? -1 : 1; // if descending, null position is before the rest
        }
        if (b === undefined) {
          return direction === 'desc' ? 1 : -1; // `a` is not null
        }
        if (a < b) {
          return direction === 'desc' ? 1 : -1;
        } else if (a > b) {
          return direction === 'desc' ? -1 : 1;
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

    if ('type' in filter) {
      return (entry) => this.cardHasType(entry, filter.type);
    }

    let on = filter?.on ?? onRef;

    if ('any' in filter) {
      let matchers = await Promise.all(
        filter.any.map((f) => this.buildMatcher(f, on))
      );
      return (entry) => some(matchers, (m) => m(entry));
    }

    if ('every' in filter) {
      let matchers = await Promise.all(
        filter.every.map((f) => this.buildMatcher(f, on))
      );
      return (entry) => every(matchers, (m) => m(entry));
    }

    if ('not' in filter) {
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

    if ('eq' in filter) {
      let ref: CardRef = on;

      let matchers = await this.buildEqMatchers(filter.eq, ref);

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
              fieldCards[fieldPath],
              value
            );

            let fieldName: string = fieldPath.split('.')[0];
            let instanceValue = entry.searchData[fieldName];

            if (instanceValue != null && typeof instanceValue === 'object') {
              let matcher = matchers.get(fieldName)?.matcher;
              let values = Array.isArray(instanceValue)
                ? instanceValue
                : [instanceValue];
              if (matcher && values.length > 0) {
                let currRef = matchers.get(fieldName)?.ref;
                let hasMatching = values
                  .map(
                    (data) =>
                      ({
                        searchData: data,
                        types: [internalKeyFor(currRef!, undefined)],
                      } as SearchEntry)
                  )
                  .some(matcher);
                if (hasMatching) {
                  return true;
                }
              } else if (Array.isArray(instanceValue)) {
                // for primitive containsMany field

                if (queryValue == null && instanceValue.length === 0) {
                  return true;
                }
                return instanceValue.includes(value);
              }
            }

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

    if ('range' in filter) {
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
            let value = this.getFieldData(entry.searchData, fieldPath);
            if (value === undefined) {
              return null;
            }

            if (
              (range.gt &&
                !(
                  value > api.getQueryableValue(fieldCards[fieldPath], range.gt)
                )) ||
              (range.lt &&
                !(
                  value < api.getQueryableValue(fieldCards[fieldPath], range.lt)
                )) ||
              (range.gte &&
                !(
                  value >=
                  api.getQueryableValue(fieldCards[fieldPath], range.gte)
                )) ||
              (range.lte &&
                !(
                  value <=
                  api.getQueryableValue(fieldCards[fieldPath], range.lte)
                ))
            ) {
              return false;
            }
            return true;
          }
          return null;
        });
    }

    throw new Error('Unknown filter');
  }

  private async buildEqMatchers(filter: EqFilter['eq'], ref: CardRef) {
    let matchers = new Map<
      string,
      {
        filters: EqFilter['eq'];
        ref: CardRef;
        matcher?: (entry: SearchEntry) => boolean | null;
      }
    >();
    let fieldNames: string[] = [];

    for (let [name, value] of Object.entries(filter)) {
      let nextRef: CardRef | undefined = ref;
      let segments = name.split('.');

      while (segments.length > 1) {
        let fieldName = segments.shift()!;
        let card = await this.loadFieldCard(nextRef, fieldName);

        nextRef = identifyCard(card);
        if (!nextRef) {
          throw new Error(`could not identify card for field ${fieldName}`);
        }

        let matcherArgs = matchers.get(fieldName);

        if (!matcherArgs) {
          matcherArgs = { filters: {}, ref: nextRef };
          fieldNames.push(fieldName);
        }

        matcherArgs.filters[segments.join('.')] = value;
        matchers.set(fieldName, matcherArgs);
      }
    }

    if (matchers.size > 0) {
      for (let fieldName of fieldNames) {
        let matcherArgs = matchers.get(fieldName);
        if (!matcherArgs) {
          continue;
        }
        let matcher = await this.buildMatcher(
          { eq: matcherArgs.filters },
          matcherArgs.ref
        );
        matcherArgs.matcher = matcher;
        matchers.set(fieldName, matcherArgs);
      }
    }

    return matchers;
  }
}

// TODO The caller should provide a list of fields to be included via JSONAPI
// request. currently we just use the maxLinkDepth to control how deep to load
// links
export async function loadLinks({
  realmURL,
  instances,
  loader,
  resource,
  omit = [],
  included = [],
  visited = [],
  stack = [],
}: {
  realmURL: URL;
  instances: URLMap<SearchEntryWithErrors>;
  loader: Loader;
  resource: LooseCardResource;
  omit?: string[];
  included?: CardResource<Saved>[];
  visited?: string[];
  stack?: string[];
}): Promise<CardResource<Saved>[]> {
  if (resource.id != null) {
    if (visited.includes(resource.id)) {
      return [];
    }
    visited.push(resource.id);
  }
  let realmPath = new RealmPaths(realmURL);
  for (let [fieldName, relationship] of Object.entries(
    resource.relationships ?? {}
  )) {
    if (!relationship.links.self) {
      continue;
    }
    let linkURL = new URL(
      relationship.links.self,
      resource.id ? new URL(resource.id) : realmURL
    );
    let linkResource: CardResource<Saved> | undefined;
    if (realmPath.inRealm(linkURL)) {
      let maybeEntry = instances.get(linkURL);
      linkResource =
        maybeEntry?.type === 'entry' ? maybeEntry.entry.resource : undefined;
    } else {
      let response = await loader.fetch(linkURL, {
        headers: { Accept: 'application/vnd.api+json' },
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
    // TODO stop using maxLinkDepth. we should save the JSON-API doc in the
    // index based on keeping track of the rendered fields and invalidate the
    // index as consumed cards change
    if (linkResource && stack.length <= maxLinkDepth) {
      for (let includedResource of await loadLinks({
        realmURL,
        instances,
        loader,
        resource: linkResource,
        omit,
        included: [...included, linkResource],
        visited,
        stack: [...(resource.id != null ? [resource.id] : []), ...stack],
      })) {
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
        type: 'card',
        id: relationship.links.self,
      };
    }
  }
  return included;
}

export function isIgnored(
  realmURL: URL,
  ignoreMap: URLMap<Ignore>,
  url: URL
): boolean {
  if (url.href === realmURL.href) {
    return false; // you can't ignore the entire realm
  }
  if (ignoreMap.size === 0) {
    return false;
  }
  // Test URL against closest ignore. (Should the ignores cascade? so that the
  // child ignore extends the parent ignore?)
  let ignoreURLs = [...ignoreMap.keys()].map((u) => u.href);
  let matchingIgnores = ignoreURLs.filter((u) => url.href.includes(u));
  let ignoreURL = matchingIgnores.sort((a, b) => b.length - a.length)[0] as
    | string
    | undefined;
  if (!ignoreURL) {
    return false;
  }
  let ignore = ignoreMap.get(new URL(ignoreURL))!;
  let realmPath = new RealmPaths(realmURL);
  let pathname = realmPath.local(url);
  return ignore.test(pathname).ignored;
}

export function serializeRunState(state: RunState): SerializableRunState {
  let {
    modules,
    instances,
    realmURL,
    ignoreMapContents: ignoreMap,
    stats,
  } = state;
  return {
    stats,
    realmURL: realmURL.href,
    modules: [...modules],
    instances: [...instances].map(([k, v]) => [k.href, v]),
    ignoreMap: [...ignoreMap].map(([k, v]) => [k.href, v]),
  };
}

export function deserializeRunState(state: SerializableRunState): RunState {
  let { modules, instances, realmURL, ignoreMap, stats } = state;
  return {
    realmURL: new URL(realmURL),
    stats,
    modules: new Map(modules),
    instances: new URLMap(instances.map(([k, v]) => [new URL(k), v])),
    ignoreMap: new URLMap(
      ignoreMap.map(([k, v]) => [new URL(k), ignore().add(v)])
    ),
    ignoreMapContents: new URLMap(ignoreMap.map(([k, v]) => [new URL(k), v])),
  };
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
