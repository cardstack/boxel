import {
  Loader,
  baseRealm,
  baseCardRef,
  LooseCardResource,
  isCardResource,
  isNotLoadedError,
  internalKeyFor,
  trimExecutableExtension,
  hasExecutableExtension,
  maxLinkDepth,
  type NotLoaded,
  type CardRef,
} from ".";
import { loadCard, identifyCard, isCard, moduleFrom } from "./card-ref";
import { Kind, Realm } from "./realm";
import { RealmPaths, LocalPath } from "./paths";
import ignore, { Ignore } from "ignore";
import isEqual from "lodash/isEqual";
import { Deferred } from "./deferred";
import flatMap from "lodash/flatMap";
import merge from "lodash/merge";
import {
  CardError,
  isCardError,
  serializableError,
  type SerializedError,
} from "./error";
import {
  isSingleCardDocument,
  type CardResource,
  type SingleCardDocument,
  type Relationship,
  type Saved,
} from "./card-document";
import {
  Card,
  type IdentityContext as IdentityContextType,
} from "https://cardstack.com/base/card-api";
import type * as CardAPI from "https://cardstack.com/base/card-api";
import type { LoaderType } from "https://cardstack.com/base/card-api";

const renderedCardTokens = {
  success: {
    start: "<!--Server Side Rendered Card START-->",
    end: "<!--Server Side Rendered Card END-->",
  },
  error: {
    start: "<!--Server Side Rendered Card Error START-->",
    end: "<!--Server Side Rendered Card Error END-->",
  },
};

// Forces callers to use URL (which avoids accidentally using relative url
// strings without a base)
class URLMap<T> {
  #map: Map<string, T>;
  constructor();
  constructor(mapTuple: [key: URL, value: T][]);
  constructor(map: URLMap<T>);
  constructor(mapInit: URLMap<T> | [key: URL, value: T][] = []) {
    if (!Array.isArray(mapInit)) {
      mapInit = [...mapInit];
    }
    this.#map = new Map(mapInit.map(([key, value]) => [key.href, value]));
  }
  has(url: URL): boolean {
    return this.#map.has(url.href);
  }
  get(url: URL): T | undefined {
    return this.#map.get(url.href);
  }
  set(url: URL, value: T) {
    return this.#map.set(url.href, value);
  }
  get [Symbol.iterator]() {
    let self = this;
    return function* () {
      for (let [key, value] of self.#map) {
        yield [new URL(key), value] as [URL, T];
      }
    };
  }
  values() {
    return this.#map.values();
  }
  keys() {
    let self = this;
    return {
      get [Symbol.iterator]() {
        return function* () {
          for (let key of self.#map.keys()) {
            yield new URL(key);
          }
        };
      },
    };
  }
  get size() {
    return this.#map.size;
  }
  remove(url: URL) {
    return this.#map.delete(url.href);
  }
}

export interface SearchEntry {
  resource: CardResource;
  searchData: Record<string, any>;
  html: string;
  types: string[];
  deps: Set<string>;
}

interface Reader {
  readFileAsText: (
    path: LocalPath,
    opts?: { withFallbacks?: true }
  ) => Promise<{ content: string; lastModified: number } | undefined>;
  readdir: (
    path: string
  ) => AsyncGenerator<{ name: string; path: string; kind: Kind }, void>;
}

interface Stats {
  instancesIndexed: number;
  instanceErrors: number;
  moduleErrors: number;
}

export type SearchEntryWithErrors =
  | { type: "entry"; entry: SearchEntry }
  | { type: "error"; error: SerializedError };
type TypesWithErrors =
  | { type: "types"; types: string[] }
  | { type: "error"; error: SerializedError };

interface Module {
  url: string;
  consumes: string[];
}
type ModuleWithErrors =
  | { type: "module"; module: Module }
  | { type: "error"; moduleURL: string; error: SerializedError };

export class CurrentRun {
  #instances: URLMap<SearchEntryWithErrors>;
  #modules = new Map<string, ModuleWithErrors>();
  #moduleWorkingCache = new Map<string, Promise<Module>>();
  #typesCache = new WeakMap<typeof Card, Promise<TypesWithErrors>>();
  #indexingInstances = new Map<string, Promise<void>>();
  #reader: Reader | undefined;
  #realmPaths: RealmPaths;
  #ignoreMap: URLMap<Ignore>;
  #loader: Loader;
  #visit: (url: string) => Promise<string>;
  #getVisitor: (
    _fetch: typeof fetch,
    staticResponses: Map<string, string>
  ) => (url: string) => Promise<string>;
  #staticResponses = new Map<string, string>();
  private realm: Realm;
  readonly stats: Stats = {
    instancesIndexed: 0,
    instanceErrors: 0,
    moduleErrors: 0,
  };

  constructor({
    realm,
    reader,
    instances = new URLMap(),
    modules = new Map(),
    ignoreMap = new URLMap(),
    loader,
    getVisitor,
  }: {
    realm: Realm;
    reader: Reader;
    instances?: URLMap<SearchEntryWithErrors>;
    modules?: Map<string, ModuleWithErrors>;
    ignoreMap?: URLMap<Ignore>;
    loader?: Loader;
    getVisitor: (
      _fetch: typeof fetch,
      staticResponses: Map<string, string>
    ) => (url: string) => Promise<string>;
  }) {
    this.#realmPaths = new RealmPaths(realm.url);
    this.#reader = reader;
    this.realm = realm;
    this.#instances = instances;
    this.#modules = modules;
    this.#ignoreMap = ignoreMap;
    this.#loader = loader ?? Loader.createLoaderFromGlobal();
    this.#getVisitor = getVisitor;
    this.#visit = getVisitor(this.fetch.bind(this), this.#staticResponses);
  }

  private fetch(
    urlOrRequest: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> {
    let requestURL =
      urlOrRequest instanceof Request
        ? urlOrRequest.url
        : typeof urlOrRequest === "string"
        ? urlOrRequest
        : urlOrRequest.href;
    let cachedJSONAPI = this.#staticResponses.get(requestURL);
    if (cachedJSONAPI != null) {
      return Promise.resolve(
        new Response(cachedJSONAPI, {
          status: 200,
          headers: {
            "content-type": "application/vnd.api+json",
            vary: "Accept",
          },
        })
      );
    }
    return this.loader.fetch(urlOrRequest, init);
  }

  private resetState() {
    this.#instances = new URLMap();
    this.#modules = new Map();
    this.#moduleWorkingCache = new Map();
    this.#typesCache = new WeakMap();
    this.#indexingInstances = new Map();
    this.#ignoreMap = new URLMap();
    this.#loader = Loader.createLoaderFromGlobal();
    this.#staticResponses = new Map();
    this.#visit = this.#getVisitor(
      this.fetch.bind(this),
      this.#staticResponses
    );
    this.stats.instancesIndexed = 0;
    this.stats.instanceErrors = 0;
    this.stats.moduleErrors = 0;
  }

  static async fromScratch(current: CurrentRun) {
    current.resetState();
    await current.visitDirectory(new URL(current.realm.url));
    return current;
  }

  static async incremental(
    url: URL,
    operation: "update" | "delete",
    prev: CurrentRun
  ) {
    let instances = new URLMap(prev.instances);
    let ignoreMap = new URLMap(prev.ignoreMap);
    let modules = new Map(prev.modules);
    instances.remove(new URL(url.href.replace(/\.json$/, "")));

    let invalidations = flatMap(invalidate(url, modules, instances), (u) =>
      // we only ever want to visit our own URL in the update case so we'll do
      // that explicitly
      u !== url.href && u !== trimExecutableExtension(url).href
        ? [new URL(u)]
        : []
    );

    let current = new this({
      realm: prev.realm,
      reader: prev.reader,
      getVisitor: prev.#getVisitor,
      instances,
      modules,
      ignoreMap,
    });

    if (operation === "update") {
      await current.visitFile(url);
    }
    for (let invalidation of invalidations) {
      await current.visitFile(invalidation);
    }
    return current;
  }

  private get reader(): Reader {
    if (!this.#reader) {
      throw new Error(`The reader is not available`);
    }
    return this.#reader;
  }

  public get instances() {
    return this.#instances;
  }

  public get modules() {
    return this.#modules;
  }

  public get ignoreMap() {
    return this.#ignoreMap;
  }

  public get loader() {
    return this.#loader;
  }

  private async visitDirectory(url: URL): Promise<void> {
    let ignorePatterns = await this.reader.readFileAsText(
      this.#realmPaths.local(new URL(".gitignore", url))
    );
    if (ignorePatterns && ignorePatterns.content) {
      this.#ignoreMap.set(url, ignore().add(ignorePatterns.content));
    }

    for await (let { path: innerPath, kind } of this.reader.readdir(
      this.#realmPaths.local(url)
    )) {
      let innerURL = this.#realmPaths.fileURL(innerPath);
      if (this.isIgnored(innerURL)) {
        continue;
      }
      if (kind === "file") {
        await this.visitFile(innerURL);
      } else {
        let directoryURL = this.#realmPaths.directoryURL(innerPath);
        await this.visitDirectory(directoryURL);
      }
    }
  }

  private async visitFile(
    url: URL,
    identityContext?: IdentityContextType,
    stack: string[] = []
  ): Promise<void> {
    if (this.isIgnored(url)) {
      return;
    }

    if (
      hasExecutableExtension(url.href) ||
      // handle modules with no extension too
      !url.href.split("/").pop()!.includes(".")
    ) {
      return await this.indexCardSource(url);
    }

    let localPath = this.#realmPaths.local(url);
    let fileRef = await this.reader.readFileAsText(localPath);
    if (!fileRef) {
      throw new Error(`missing file ${localPath}`);
    }
    if (!identityContext) {
      let api = await this.#loader.import<typeof CardAPI>(
        `${baseRealm.url}card-api`
      );
      let { IdentityContext } = api;
      identityContext = new IdentityContext();
    }

    let { content, lastModified } = fileRef;
    if (url.href.endsWith(".json")) {
      let { data: resource } = JSON.parse(content);
      if (isCardResource(resource)) {
        await this.indexCard(
          localPath,
          lastModified,
          resource,
          identityContext,
          stack
        );
      }
    }
  }

  private async indexCardSource(url: URL): Promise<void> {
    let module: Record<string, unknown>;
    try {
      module = await this.loader.import(url.href);
    } catch (err: any) {
      this.stats.moduleErrors++;
      if ((globalThis as any).process?.env?.SUPPRESS_ERRORS !== "true") {
        console.warn(
          `encountered error loading module "${url.href}": ${err.message}`
        );
      }
      let deps = await (
        await this.loader.getConsumedModules(url.href)
      ).filter((u) => u !== url.href);
      this.#modules.set(url.href, {
        type: "error",
        moduleURL: url.href,
        error: {
          status: 500,
          detail: `encountered error loading module "${url.href}": ${err.message}`,
          additionalErrors: null,
          deps,
        },
      });
      return;
    }

    let refs = Object.values(module)
      .filter((maybeCard) => isCard(maybeCard))
      .map((card) => identifyCard(card))
      .filter(Boolean) as CardRef[];
    for (let ref of refs) {
      if (!("type" in ref)) {
        await this.buildModule(ref.module, url);
      }
    }
  }

  private async recomputeCard(
    card: Card,
    fileURL: string,
    identityContext: IdentityContextType,
    stack: string[]
  ): Promise<void> {
    let api = await this.#loader.import<typeof CardAPI>(
      `${baseRealm.url}card-api`
    );
    try {
      await api.recompute(card, {
        loadFields: stack.length < maxLinkDepth ? true : undefined,
      });
    } catch (err: any) {
      let notLoadedErr: NotLoaded | undefined;
      if (
        isCardError(err) &&
        (notLoadedErr = [err, ...(err.additionalErrors || [])].find(
          isNotLoadedError
        ) as NotLoaded | undefined)
      ) {
        let linkURL = new URL(`${notLoadedErr.reference}.json`);
        if (this.#realmPaths.inRealm(linkURL)) {
          await this.visitFile(linkURL, identityContext, [fileURL, ...stack]);
          await api.recompute(card, { loadFields: true });
        } else {
          // in this case the instance we are linked to is a missing instance
          // in an external realm.
          throw err;
        }
      } else {
        throw err;
      }
    }
  }

  private async indexCard(
    path: LocalPath,
    lastModified: number,
    resource: LooseCardResource,
    identityContext: IdentityContextType,
    stack: string[]
  ): Promise<void> {
    let fileURL = this.#realmPaths.fileURL(path).href;
    let indexingInstance = this.#indexingInstances.get(fileURL);
    if (indexingInstance) {
      return await indexingInstance;
    }
    let deferred = new Deferred<void>();
    this.#indexingInstances.set(fileURL, deferred.promise);
    let instanceURL = new URL(
      this.#realmPaths.fileURL(path).href.replace(/\.json$/, "")
    );
    let moduleURL = new URL(
      moduleFrom(resource.meta.adoptsFrom),
      new URL(path, this.realm.url)
    ).href;
    let typesMaybeError: TypesWithErrors | undefined;
    let uncaughtError: Error | undefined;
    let doc: SingleCardDocument | undefined;
    let searchData: Record<string, any> | undefined;
    let html: string | undefined;
    let cardType: typeof Card | undefined;
    try {
      let api = await this.#loader.import<typeof CardAPI>(
        `${baseRealm.url}card-api`
      );
      let res = { ...resource, ...{ id: instanceURL.href } };
      let card = await api.createFromSerialized<typeof Card>(
        res,
        { data: res },
        new URL(fileURL),
        {
          identityContext,
          loader: this.#loader as unknown as LoaderType,
        }
      );
      await this.recomputeCard(card, fileURL, identityContext, stack);
      cardType = Reflect.getPrototypeOf(card)?.constructor as typeof Card;
      let data = api.serializeCard(card, {
        includeComputeds: true,
      });
      // prepare the document for index serialization
      Object.values(data.data.relationships ?? {}).forEach(
        (rel) => delete (rel as Relationship).data
      );
      doc = merge(data, {
        data: {
          id: instanceURL.href,
          meta: { lastModified: lastModified },
        },
      }) as SingleCardDocument;
      searchData = await api.searchDoc(card);
      if (!searchData) {
        throw new Error(
          `bug: could not derive search doc for instance ${instanceURL.href}`
        );
      }
      let cachedDoc: SingleCardDocument = merge({}, doc, {
        data: {
          links: { self: instanceURL.href },
        },
      });
      // TODO this is the response that will feed the card rendering, but how
      // will we know how deep to load links before we have actually rendered
      // the card?
      let included = await this.loadLinks(cachedDoc.data, [cachedDoc.data.id]);
      if (included.length > 0) {
        cachedDoc.included = included;
      }
      this.#staticResponses.set(
        instanceURL.href,
        JSON.stringify(cachedDoc, null, 2)
      );
      let rawHtml: string | undefined;
      rawHtml = await this.#visit(
        `/render?url=${encodeURIComponent(instanceURL.href)}&format=isolated`
      );
      html = parseRenderedCard(rawHtml);
    } catch (err: any) {
      uncaughtError = err;
    }
    // if we already encountered an uncaught error then no need to deal with this
    if (!uncaughtError && cardType) {
      typesMaybeError = await this.getTypes(cardType);
    }
    if (html && searchData && doc && typesMaybeError?.type === "types") {
      this.stats.instancesIndexed++;
      this.#instances.set(instanceURL, {
        type: "entry",
        entry: {
          resource: doc.data,
          searchData,
          html,
          types: typesMaybeError.types,
          deps: new Set(await this.loader.getConsumedModules(moduleURL)),
        },
      });
      deferred.fulfill();
    }

    if (uncaughtError || typesMaybeError?.type === "error") {
      this.stats.instanceErrors++;
      let error: SearchEntryWithErrors;
      if (uncaughtError) {
        error = {
          type: "error",
          error:
            uncaughtError instanceof CardError
              ? serializableError(uncaughtError)
              : { detail: `${uncaughtError.message}` },
        };
        error.error.deps = [moduleURL];
      } else if (typesMaybeError?.type === "error") {
        error = { type: "error", error: typesMaybeError.error };
      } else {
        let err = new Error(`bug: should never get here`);
        deferred.reject(err);
        throw err;
      }
      if ((globalThis as any).process?.env?.SUPPRESS_ERRORS !== "true") {
        console.warn(
          `encountered error indexing card instance ${path}: ${error.error.detail}`
        );
      }
      this.#instances.set(instanceURL, error);
      deferred.fulfill();
    }
  }

  public async buildModule(
    moduleIdentifier: string,
    relativeTo = new URL(this.realm.url)
  ): Promise<void> {
    let url = new URL(moduleIdentifier, relativeTo).href;
    let existing = this.#modules.get(url);
    if (existing?.type === "error") {
      throw new Error(
        `bug: card definition has errors which should never happen since the card already executed successfully: ${url}`
      );
    }
    if (existing) {
      return;
    }

    let working = this.#moduleWorkingCache.get(url);
    if (working) {
      await working;
      return;
    }

    let deferred = new Deferred<Module>();
    this.#moduleWorkingCache.set(url, deferred.promise);
    let m = await this.#loader.import<Record<string, any>>(moduleIdentifier);
    if (m) {
      for (let exportName of Object.keys(m)) {
        m[exportName];
      }
    }
    let consumes = (await this.loader.getConsumedModules(url)).filter(
      (u) => u !== url
    );
    let module: Module = {
      url,
      consumes,
    };
    this.#modules.set(url, { type: "module", module });
    deferred.fulfill(module);
  }

  private async getTypes(card: typeof Card): Promise<TypesWithErrors> {
    let cached = this.#typesCache.get(card);
    if (cached) {
      return await cached;
    }
    let ref = identifyCard(card);
    if (!ref) {
      throw new Error(`could not identify card ${card.name}`);
    }
    let deferred = new Deferred<TypesWithErrors>();
    this.#typesCache.set(card, deferred.promise);
    let types: string[] = [];
    let fullRef: CardRef = ref;
    while (fullRef) {
      let loadedCard = await loadCard(fullRef, { loader: this.loader });
      let loadedCardRef = identifyCard(loadedCard);
      if (!loadedCardRef) {
        throw new Error(`could not identify card ${loadedCard.name}`);
      }
      types.push(internalKeyFor(loadedCardRef, undefined));
      if (!isEqual(loadedCardRef, baseCardRef)) {
        fullRef = {
          type: "ancestorOf",
          card: loadedCardRef,
        };
      } else {
        break;
      }
    }
    let result: TypesWithErrors = { type: "types", types };
    deferred.fulfill(result);
    return result;
  }

  public isIgnored(url: URL): boolean {
    if (url.href === this.realm.url) {
      return false; // you can't ignore the entire realm
    }
    if (this.ignoreMap.size === 0) {
      return false;
    }
    // Test URL against closest ignore. (Should the ignores cascade? so that the
    // child ignore extends the parent ignore?)
    let ignoreURLs = [...this.ignoreMap.keys()].map((u) => u.href);
    let matchingIgnores = ignoreURLs.filter((u) => url.href.includes(u));
    let ignoreURL = matchingIgnores.sort((a, b) => b.length - a.length)[0] as
      | string
      | undefined;
    if (!ignoreURL) {
      return false;
    }
    let ignore = this.ignoreMap.get(new URL(ignoreURL))!;
    let pathname = this.#realmPaths.local(url);
    return ignore.test(pathname).ignored;
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
        let maybeEntry = this.instances.get(new URL(relationship.links.self));
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
}

function invalidate(
  url: URL,
  modules: Map<string, ModuleWithErrors>,
  instances: URLMap<SearchEntryWithErrors>,
  invalidations: string[] = [],
  visited: Set<string> = new Set()
): string[] {
  if (visited.has(url.href)) {
    return [];
  }

  let invalidationSet = new Set(invalidations);
  // invalidate any instances whose deps come from the URL or whose error depends on the URL
  let invalidatedInstances = [...instances]
    .filter(([instanceURL, item]) => {
      if (item.type === "error") {
        for (let errorModule of item.error.deps ?? []) {
          if (
            errorModule === url.href ||
            errorModule === trimExecutableExtension(url).href
          ) {
            instances.remove(instanceURL); // note this is a side-effect
            return true;
          }
        }
      } else {
        if (
          item.entry.deps.has(url.href) ||
          item.entry.deps.has(trimExecutableExtension(url).href)
        ) {
          instances.remove(instanceURL); // note this is a side-effect
          return true;
        }
      }
      return false;
    })
    .map(([u]) => `${u.href}.json`);
  for (let invalidation of invalidatedInstances) {
    invalidationSet.add(invalidation);
  }

  for (let [key, maybeError] of [...modules]) {
    if (maybeError.type === "error") {
      // invalidate any errored modules that come from the URL
      let errorModule = maybeError.moduleURL;
      if (
        errorModule === url.href ||
        errorModule === trimExecutableExtension(url).href
      ) {
        modules.delete(key);
        invalidationSet.add(errorModule);
      }

      // invalidate any modules in an error state whose errorReference comes
      // from the URL
      for (let maybeDef of maybeError.error.deps ?? []) {
        if (
          maybeDef === url.href ||
          maybeDef === trimExecutableExtension(url).href
        ) {
          for (let invalidation of invalidate(
            new URL(errorModule),
            modules,
            instances,
            [...invalidationSet],
            new Set([...visited, url.href])
          )) {
            invalidationSet.add(invalidation);
          }
          // no need to test the other error refs, we have already decided to
          // invalidate this URL
          break;
        }
      }
      continue;
    }

    let { module } = maybeError;
    // invalidate any modules that come from the URL
    if (
      module.url === url.href ||
      module.url === trimExecutableExtension(url).href
    ) {
      modules.delete(key);
      invalidationSet.add(module.url);
    }

    // invalidate any modules that consume the URL
    for (let importURL of module.consumes) {
      if (
        importURL === url.href ||
        importURL === trimExecutableExtension(url).href
      ) {
        for (let invalidation of invalidate(
          new URL(module.url),
          modules,
          instances,
          [...invalidationSet],
          new Set([...visited, url.href])
        )) {
          invalidationSet.add(invalidation);
        }
        // no need to test the other imports, we have already decided to
        // invalidate this URL
        break;
      }
    }
  }

  return [...invalidationSet];
}

function parseRenderedCard(html: string): string {
  if (html.includes(renderedCardTokens.success.start)) {
    return html.substring(
      html.indexOf(renderedCardTokens.success.start) +
        renderedCardTokens.success.start.length,
      html.indexOf(renderedCardTokens.success.end)
    );
  } else if (html.includes(renderedCardTokens.error.start)) {
    let errorMsg = html.substring(
      html.indexOf(renderedCardTokens.error.start) +
        renderedCardTokens.error.start.length,
      html.indexOf(renderedCardTokens.error.end)
    );
    throw new CardError(`encountered error when rendering card:\n${errorMsg}`);
  } else {
    throw new CardError(
      `do not know how to handle rendered card output:\n${html}`
    );
  }
}
