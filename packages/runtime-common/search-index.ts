import {
  baseRealm,
  SupportedMimeType,
  internalKeyFor,
  maxLinkDepth,
  maybeURL,
  type LooseCardResource,
  logger,
} from '.';
import { Kind, Realm } from './realm';
import { LocalPath, RealmPaths } from './paths';
import { Loader } from './loader';
import type {
  Query,
  Filter,
  Sort,
  EqFilter,
  ContainsFilter,
  RangeFilter,
} from './query';
import { CardError, type SerializedError } from './error';
import { URLMap } from './url-map';
import flatMap from 'lodash/flatMap';
import { type Ignore } from 'ignore';
import type { BaseDef, Field } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import { type CodeRef, getField, identifyCard, loadCard } from './code-ref';
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
    opts?: { withFallbacks?: true },
  ) => Promise<{ content: string; lastModified: number } | undefined>;
  readdir: (
    path: string,
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

export type RunnerRegistration = (
  fromScratch: (realmURL: URL) => Promise<RunState>,
  incremental: (
    prev: RunState,
    url: URL,
    operation: 'update' | 'delete',
    onInvalidation?: (invalidatedURLs: URL[]) => void,
  ) => Promise<RunState>,
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
  #realm: Realm;
  #runner: IndexRunner;
  runnerOptsMgr: RunnerOptionsManager;
  #reader: Reader;
  #index: CurrentIndex;
  #fromScratch: ((realmURL: URL) => Promise<RunState>) | undefined;
  #incremental:
    | ((
        prev: RunState,
        url: URL,
        operation: 'update' | 'delete',
        onInvalidation?: (invalidatedURLs: URL[]) => void,
      ) => Promise<RunState>)
    | undefined;

  constructor(
    realm: Realm,
    readdir: (
      path: string,
    ) => AsyncGenerator<{ name: string; path: string; kind: Kind }, void>,
    readFileAsText: (
      path: LocalPath,
      opts?: { withFallbacks?: true },
    ) => Promise<{ content: string; lastModified: number } | undefined>,
    runner: IndexRunner,
    runnerOptsManager: RunnerOptionsManager,
  ) {
    this.#realm = realm;
    this.#reader = { readdir, readFileAsText };
    this.runnerOptsMgr = runnerOptsManager;
    this.#runner = runner;
    this.#index = {
      realmURL: new URL(realm.url),
      loader: Loader.cloneLoader(realm.loader),
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
        loader: Loader.cloneLoader(this.#realm.loader),
      };
    });
  }

  async update(
    url: URL,
    opts?: { delete?: true; onInvalidation?: (invalidatedURLs: URL[]) => void },
  ): Promise<void> {
    logger('realm').debug(`search index update called`); // remove after debugging slow card source writing
    await this.setupRunner(async () => {
      if (!this.#incremental) {
        throw new Error(`Index runner has not been registered`);
      }
      logger('realm').debug(`calling #incremental`); // remove after debugging slow card source writing
      let current = await this.#incremental(
        this.#index,
        url,
        opts?.delete ? 'delete' : 'update',
        opts?.onInvalidation,
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
        loader: Loader.cloneLoader(this.#realm.loader),
      };
      logger('realm').debug(`search index update finished`); // remove after debugging slow card source writing
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
      name: 'CardDef',
    });

    let doc: CardCollectionDocument = {
      data: flatMap([...this.#index.instances.values()], (maybeError) =>
        maybeError.type !== 'error' ? [maybeError.entry] : [],
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
    // TODO this may be called before search index is ready in which case we
    // should provide a default ignore list. But really we should decouple the
    // realm's consumption of this from the search index so that the realm can
    // figure out what files are ignored before indexing has happened.
    if (
      ['node_modules'].includes(url.href.replace(/\/$/, '').split('/').pop()!)
    ) {
      return true;
    }
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

  private cardHasType(entry: SearchEntry, ref: CodeRef): boolean {
    return Boolean(
      entry.types?.find((t) => t === internalKeyFor(ref, undefined)), // assumes ref refers to absolute module URL
    );
  }

  private async loadField(ref: CodeRef, fieldPath: string): Promise<Field> {
    let composite: typeof BaseDef | undefined;
    try {
      composite = await loadCard(ref, { loader: this.loader });
    } catch (err: any) {
      if (!('type' in ref)) {
        throw new Error(
          `Your filter refers to nonexistent type: import ${
            ref.name === 'default' ? 'default' : `{ ${ref.name} }`
          } from "${ref.module}"`,
        );
      } else {
        throw new Error(
          `Your filter refers to nonexistent type: ${JSON.stringify(
            ref,
            null,
            2,
          )}`,
        );
      }
    }
    let segments = fieldPath.split('.');
    let field: Field | undefined;
    while (segments.length) {
      let fieldName = segments.shift()!;
      let prevField = field;
      field = getField(composite, fieldName);
      if (!field) {
        throw new Error(
          `Your filter refers to nonexistent field "${fieldName}" on type ${JSON.stringify(
            identifyCard(prevField ? prevField.card : composite),
          )}`,
        );
      }
    }
    return field!;
  }

  private getFieldData(searchData: Record<string, any>, fieldPath: string) {
    let data = searchData;
    let segments = fieldPath.split('.');
    while (segments.length && data != null) {
      let fieldName = segments.shift()!;
      data = data[fieldName];
    }
    return data;
  }

  private buildSorter(
    expressions: Sort | undefined,
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
    onRef: CodeRef,
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
        filter.any.map((f) => this.buildMatcher(f, on)),
      );
      return (entry) => some(matchers, (m) => m(entry));
    }

    if ('every' in filter) {
      let matchers = await Promise.all(
        filter.every.map((f) => this.buildMatcher(f, on)),
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

    if ('eq' in filter || 'contains' in filter) {
      return await this.buildEqOrContainsMatchers(filter, on);
    }

    if ('range' in filter) {
      return await this.buildRangeMatchers(filter.range, on);
    }

    throw new Error('Unknown filter');
  }

  private async buildRangeMatchers(
    range: RangeFilter['range'],
    ref: CodeRef,
  ): Promise<(entry: SearchEntry) => boolean | null> {
    // TODO when we are ready to execute queries within computeds, we'll need to
    // use the loader instance from current-run and not the global loader, as
    // the card definitions may have changed in the current-run loader
    let api = await this.loadAPI();

    let matchers: ((instanceData: Record<string, any>) => boolean | null)[] =
      [];

    for (let [name, value] of Object.entries(range)) {
      // Load the stack of fields we're accessing
      let fields: Field[] = [];
      let nextRef: CodeRef | undefined = ref;
      let segments = name.split('.');
      while (segments.length > 0) {
        let fieldName = segments.shift()!;
        let field = await this.loadField(nextRef, fieldName);
        fields.push(field);
        nextRef = identifyCard(field.card);
        if (!nextRef) {
          throw new Error(`could not identify card for field ${fieldName}`);
        }
      }

      let qValueGT = api.getQueryableValue(fields[fields.length - 1], value.gt);
      let qValueLT = api.getQueryableValue(fields[fields.length - 1], value.lt);
      let qValueGTE = api.getQueryableValue(
        fields[fields.length - 1],
        value.gte,
      );
      let qValueLTE = api.getQueryableValue(
        fields[fields.length - 1],
        value.lte,
      );
      let queryValue = qValueGT ?? qValueLT ?? qValueGTE ?? qValueLTE;

      let matcher = (instanceValue: any) => {
        if (instanceValue == null || queryValue == null) {
          return null;
        }
        // checking for not null below is necessary because queryValue can be 0
        if (
          (qValueGT != null && !(instanceValue > qValueGT)) ||
          (qValueLT != null && !(instanceValue < qValueLT)) ||
          (qValueGTE != null && !(instanceValue >= qValueGTE)) ||
          (qValueLTE != null && !(instanceValue <= qValueLTE))
        ) {
          return false;
        }
        return true;
      };

      while (fields.length > 0) {
        let nextField = fields.pop()!;
        let nextMatcher = nextField.queryMatcher(matcher);
        matcher = (instanceValue: any) => {
          if (instanceValue == null || queryValue == null) {
            return null;
          }
          return nextMatcher(instanceValue[nextField.name]);
        };
      }
      matchers.push(matcher);
    }

    return (entry) =>
      every(matchers, (m) => {
        if (this.cardHasType(entry, ref)) {
          return m(entry.searchData);
        }
        return null;
      });
  }

  private async buildEqOrContainsMatchers(
    filter: EqFilter | ContainsFilter,
    ref: CodeRef,
  ): Promise<(entry: SearchEntry) => boolean | null> {
    let filterType: 'eq' | 'contains';
    let filterValue: EqFilter['eq'] | ContainsFilter['contains'];
    if ('eq' in filter) {
      filterType = 'eq';
      filterValue = filter.eq;
    } else if ('contains' in filter) {
      filterType = 'contains';
      filterValue = filter.contains;
    } else {
      throw new Error('Invalid filter type');
    }
    // TODO when we are ready to execute queries within computeds, we'll need to
    // use the loader instance from current-run and not the global loader, as
    // the card definitions may have changed in the current-run loader
    let api = await this.loadAPI();

    let matchers: ((instanceData: Record<string, any>) => boolean | null)[] =
      [];

    for (let [name, value] of Object.entries(filterValue)) {
      // Load the stack of fields we're accessing
      let fields: Field[] = [];
      let nextRef: CodeRef | undefined = ref;
      let segments = name.split('.');
      while (segments.length > 0) {
        let fieldName = segments.shift()!;
        let field = await this.loadField(nextRef, fieldName);
        fields.push(field);
        nextRef = identifyCard(field.card);
        if (!nextRef) {
          throw new Error(`could not identify card for field ${fieldName}`);
        }
      }

      let queryValue = api.getQueryableValue(fields[fields.length - 1], value);
      let matcher: (instanceValue: any) => boolean | null;
      if (filterType === 'eq') {
        matcher = (instanceValue: any) => {
          if (instanceValue === undefined && queryValue != null) {
            return null;
          }
          // allows queries for null to work
          if (queryValue == null && instanceValue == null) {
            return true;
          }
          return instanceValue === queryValue;
        };
      } else {
        matcher = (instanceValue: any) => {
          if (
            (instanceValue == null && queryValue != null) ||
            (instanceValue != null && queryValue == null)
          ) {
            return null;
          }
          if (instanceValue == null && queryValue == null) {
            return true;
          }
          return (instanceValue as string)
            .toLowerCase()
            .includes((queryValue as string).toLowerCase());
        };
      }
      while (fields.length > 0) {
        let nextField = fields.pop()!;
        let nextMatcher = nextField.queryMatcher(matcher);
        matcher = (instanceValue: any) => {
          if (instanceValue == null && queryValue != null) {
            return null;
          }
          if (instanceValue == null && queryValue == null) {
            return true;
          }
          return nextMatcher(instanceValue[nextField.name]);
        };
      }
      matchers.push(matcher);
    }

    return (entry) =>
      every(matchers, (m) => {
        if (this.cardHasType(entry, ref)) {
          return m(entry.searchData);
        }
        return null;
      });
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
    resource.relationships ?? {},
  )) {
    if (!relationship.links.self) {
      continue;
    }
    let linkURL = new URL(
      relationship.links.self,
      resource.id ? new URL(resource.id) : realmURL,
    );
    let linkResource: CardResource<Saved> | undefined;
    if (realmPath.inRealm(linkURL)) {
      let maybeEntry = instances.get(linkURL);
      linkResource =
        maybeEntry?.type === 'entry' ? maybeEntry.entry.resource : undefined;
    } else {
      let response = await loader.fetch(linkURL, {
        headers: { Accept: SupportedMimeType.CardJson },
      });
      if (!response.ok) {
        let cardError = await CardError.fromFetchResponse(
          linkURL.href,
          response,
        );
        throw cardError;
      }
      let json = await response.json();
      if (!isSingleCardDocument(json)) {
        throw new Error(
          `instance ${
            linkURL.href
          } is not a card document. it is: ${JSON.stringify(json, null, 2)}`,
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
    let relationshipId = maybeURL(relationship.links.self, resource.id);
    if (!relationshipId) {
      throw new Error(
        `bug: unable to turn relative URL '${relationship.links.self}' into an absolute URL relative to ${resource.id}`,
      );
    }
    if (foundLinks || omit.includes(relationshipId.href)) {
      resource.relationships![fieldName].data = {
        type: 'card',
        id: relationshipId.href,
      };
    }
  }
  return included;
}

export function isIgnored(
  realmURL: URL,
  ignoreMap: URLMap<Ignore>,
  url: URL,
): boolean {
  if (url.href === realmURL.href) {
    return false; // you can't ignore the entire realm
  }
  if (url.href === realmURL.href + '.realm.json') {
    return true;
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

// three-valued version of Array.every that propagates nulls. Here, the presence
// of any nulls causes the whole thing to be null.
function every<T>(
  list: T[],
  predicate: (t: T) => boolean | null,
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
  predicate: (t: T) => boolean | null,
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
