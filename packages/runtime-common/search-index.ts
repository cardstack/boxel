import { Memoize } from 'typescript-memoize';
import {
  SupportedMimeType,
  maxLinkDepth,
  maybeURL,
  Indexer,
  type Stats,
  type LooseCardResource,
  type DBAdapter,
  type Queue,
  type QueryOptions,
  type SearchCardResult,
  type FromScratchArgs,
  type FromScratchResult,
  type IncrementalArgs,
  type IncrementalResult,
} from '.';
import { Realm } from './realm';
import { RealmPaths } from './paths';
import { Loader } from './loader';
import type { Query } from './query';
import { CardError, type SerializedError } from './error';
import { URLMap } from './url-map';
import ignore, { type Ignore } from 'ignore';
import {
  isSingleCardDocument,
  type SingleCardDocument,
  type CardCollectionDocument,
  type CardResource,
  type Saved,
} from './card-document';

type Options = {
  loadLinks?: true;
} & QueryOptions;

type SearchResult = SearchResultDoc | SearchResultError;
interface SearchResultDoc {
  type: 'doc';
  doc: SingleCardDocument;
}
interface SearchResultError {
  type: 'error';
  error: SerializedError;
}

export class SearchIndex {
  #realm: Realm;
  #loader: Loader;
  #ignoreData: Record<string, string> = {};
  #stats: Stats = {
    instancesIndexed: 0,
    instanceErrors: 0,
    moduleErrors: 0,
  };
  #indexer: Indexer;
  #queue: Queue;

  constructor({
    realm,
    dbAdapter,
    queue,
  }: {
    realm: Realm;
    dbAdapter: DBAdapter;
    queue: Queue;
  }) {
    if (!dbAdapter) {
      throw new Error(
        `DB Adapter was not provided to SearchIndex constructor--this is required when using a db based index`,
      );
    }
    this.#indexer = new Indexer(dbAdapter);
    this.#queue = queue;
    this.#realm = realm;
    this.#loader = Loader.cloneLoader(this.#realm.loaderTemplate);
  }

  get stats() {
    return this.#stats;
  }

  get loader() {
    return this.#loader;
  }

  @Memoize()
  private get realmURL() {
    return new URL(this.#realm.url);
  }

  @Memoize()
  private get ignoreMap() {
    let ignoreMap = new URLMap<Ignore>();
    for (let [url, contents] of Object.entries(this.#ignoreData)) {
      ignoreMap.set(new URL(url), ignore().add(contents));
    }
    return ignoreMap;
  }

  async run(onIndexer?: (indexer: Indexer) => Promise<void>) {
    await this.#queue.start();
    await this.#indexer.ready();
    if (onIndexer) {
      await onIndexer(this.#indexer);
    }

    let args: FromScratchArgs = {
      realmURL: this.#realm.url,
    };
    let job = await this.#queue.publish<FromScratchResult>(
      `from-scratch-index:${this.#realm.url}`,
      args,
    );
    let { ignoreData, stats } = await job.done;
    this.#stats = stats;
    this.#ignoreData = ignoreData;
    this.#loader = Loader.cloneLoader(this.#realm.loaderTemplate);
  }

  async update(
    url: URL,
    opts?: { delete?: true; onInvalidation?: (invalidatedURLs: URL[]) => void },
  ): Promise<void> {
    let args: IncrementalArgs = {
      url: url.href,
      realmURL: this.#realm.url,
      operation: opts?.delete ? 'delete' : 'update',
      ignoreData: { ...this.#ignoreData },
    };
    let job = await this.#queue.publish<IncrementalResult>(
      `incremental-index:${this.#realm.url}`,
      args,
    );
    let { invalidations, ignoreData, stats } = await job.done;
    this.#stats = stats;
    this.#ignoreData = ignoreData;
    this.#loader = Loader.cloneLoader(this.#realm.loaderTemplate);
    if (opts?.onInvalidation) {
      opts.onInvalidation(
        invalidations.map((href) => new URL(href.replace(/\.json$/, ''))),
      );
    }
  }

  async search(query: Query, opts?: Options): Promise<CardCollectionDocument> {
    let doc: CardCollectionDocument;
    let { cards: data, meta: _meta } = await this.#indexer.search(
      new URL(this.#realm.url),
      query,
      this.loader,
      opts,
    );
    doc = {
      data: data.map((resource) => ({
        ...resource,
        ...{ links: { self: resource.id } },
      })),
    };

    let omit = doc.data.map((r) => r.id);
    // TODO eventually the links will be cached in the index, and this will only
    // fill in the included resources for links that were not cached (e.g.
    // volatile fields)
    if (opts?.loadLinks) {
      let included: CardResource<Saved>[] = [];
      for (let resource of doc.data) {
        included = await this.loadLinks(
          {
            realmURL: this.realmURL,
            resource,
            omit,
            included,
          },
          opts,
        );
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
    return isIgnored(this.realmURL, this.ignoreMap, url);
  }

  async card(url: URL, opts?: Options): Promise<SearchResult | undefined> {
    let doc: SingleCardDocument | undefined;
    let maybeCard = await this.#indexer.getCard(url, opts);
    if (!maybeCard) {
      return undefined;
    }
    if (maybeCard.type === 'error') {
      return maybeCard;
    }
    doc = {
      data: { ...maybeCard.card, ...{ links: { self: url.href } } },
    };
    if (!doc) {
      throw new Error(
        `bug: should never get here--search index doc is undefined`,
      );
    }
    if (opts?.loadLinks) {
      let included = await this.loadLinks(
        {
          realmURL: this.realmURL,
          resource: doc.data,
          omit: [doc.data.id],
        },
        opts,
      );
      if (included.length > 0) {
        doc.included = included;
      }
    }
    return { type: 'doc', doc };
  }

  // this is meant for tests only
  async searchEntry(url: URL): Promise<SearchCardResult | undefined> {
    let result = await this.#indexer.getCard(url);
    if (result?.type === 'error') {
      return undefined;
    }
    return result;
  }

  // TODO The caller should provide a list of fields to be included via JSONAPI
  // request. currently we just use the maxLinkDepth to control how deep to load
  // links
  private async loadLinks(
    {
      realmURL,
      resource,
      omit = [],
      included = [],
      visited = [],
      stack = [],
    }: {
      realmURL: URL;
      resource: LooseCardResource;
      omit?: string[];
      included?: CardResource<Saved>[];
      visited?: string[];
      stack?: string[];
    },
    opts?: Options,
  ): Promise<CardResource<Saved>[]> {
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
        let maybeResult = await this.#indexer.getCard(linkURL, opts);
        linkResource =
          maybeResult?.type === 'card' ? maybeResult.card : undefined;
      } else {
        let response = await this.loader.fetch(linkURL, {
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
        for (let includedResource of await this.loadLinks(
          {
            realmURL,
            resource: linkResource,
            omit,
            included: [...included, linkResource],
            visited,
            stack: [...(resource.id != null ? [resource.id] : []), ...stack],
          },
          opts,
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
      let relationshipId = maybeURL(relationship.links.self, resource.id);
      if (!relationshipId) {
        throw new Error(
          `bug: unable to turn relative URL '${relationship.links.self}' into an absolute URL relative to ${resource.id}`,
        );
      }
      if (
        foundLinks ||
        omit.includes(relationshipId.href) ||
        (relationshipId && included.find((i) => i.id === relationshipId!.href))
      ) {
        resource.relationships![fieldName].data = {
          type: 'card',
          id: relationshipId.href,
        };
      }
    }
    return included;
  }
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
