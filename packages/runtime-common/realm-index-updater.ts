import { Memoize } from 'typescript-memoize';
import {
  IndexWriter,
  Deferred,
  logger,
  fetchUserPermissions,
  type Stats,
  type DBAdapter,
  type Queue,
  type WorkerArgs,
  type FromScratchResult,
  type IncrementalArgs,
  type IncrementalResult,
} from '.';
import { Realm } from './realm';
import { RealmPaths } from './paths';
import { Loader } from './loader';
import ignore, { type Ignore } from 'ignore';
import { getMatrixUsername } from './matrix-client';

export class RealmIndexUpdater {
  #realm: Realm;
  #loader: Loader;
  #log = logger('realm-index-updater');
  #ignoreData: Record<string, string> = {};
  #stats: Stats = {
    instancesIndexed: 0,
    modulesIndexed: 0,
    instanceErrors: 0,
    moduleErrors: 0,
    totalIndexEntries: 0,
  };
  #indexWriter: IndexWriter;
  #queue: Queue;
  #dbAdapter: DBAdapter;
  #indexingDeferred: Deferred<void> | undefined;

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
    this.#indexWriter = new IndexWriter(dbAdapter);
    this.#queue = queue;
    this.#dbAdapter = dbAdapter;
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

  private get ignoreMap() {
    let ignoreMap = new Map<string, Ignore>();
    for (let [url, contents] of Object.entries(this.#ignoreData)) {
      ignoreMap.set(url, ignore().add(contents));
    }
    return ignoreMap;
  }

  async isNewIndex(): Promise<boolean> {
    return await this.#indexWriter.isNewIndex(this.realmURL);
  }

  async run() {
    await this.fullIndex();
  }

  indexing() {
    return this.#indexingDeferred?.promise;
  }

  // TODO consider triggering SSE events for invalidations now that we can
  // calculate fine grained invalidations for from-scratch indexing by passing
  // in an onInvalidation callback
  async fullIndex() {
    this.#indexingDeferred = new Deferred<void>();
    try {
      let args: WorkerArgs = {
        realmURL: this.#realm.url,
        realmUsername: await this.getRealmUsername(),
      };
      let job = await this.#queue.publish<FromScratchResult>(
        `from-scratch-index`,
        args,
      );
      let { ignoreData, stats } = await job.done;
      this.#stats = stats;
      this.#ignoreData = ignoreData;
      this.#loader = Loader.cloneLoader(this.#realm.loaderTemplate);
      this.#log.info(
        `Realm ${this.realmURL.href} has completed indexing: ${JSON.stringify(
          stats,
          null,
          2,
        )}`,
      );
    } catch (e: any) {
      this.#indexingDeferred.reject(e);
      throw e;
    } finally {
      this.#indexingDeferred.fulfill();
    }
  }

  async update(
    url: URL,
    opts?: { delete?: true; onInvalidation?: (invalidatedURLs: URL[]) => void },
  ): Promise<void> {
    this.#indexingDeferred = new Deferred<void>();
    try {
      let args: IncrementalArgs = {
        url: url.href,
        realmURL: this.#realm.url,
        realmUsername: await this.getRealmUsername(),
        operation: opts?.delete ? 'delete' : 'update',
        ignoreData: { ...this.#ignoreData },
      };
      let job = await this.#queue.publish<IncrementalResult>(
        `incremental-index`,
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
    } catch (e: any) {
      this.#indexingDeferred.reject(e);
      throw e;
    } finally {
      this.#indexingDeferred.fulfill();
    }
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

  private async getRealmUsername(): Promise<string> {
    let permissions = await fetchUserPermissions(
      this.#dbAdapter,
      this.realmURL,
    );
    let owners = Object.entries(permissions)
      .filter(([_, permissions]) => permissions.includes('realm-owner'))
      .map(([userId]) => userId);
    let realmUserId =
      owners.length === 1
        ? owners[0]
        : owners.find((userId) => userId.startsWith('@realm/'));
    if (realmUserId) {
      return getMatrixUsername(realmUserId);
    }

    // hard coded test URLs
    switch (this.realmURL.href) {
      case 'http://127.0.0.1:4441/':
        return 'base_realm';
      case 'http://example.com':
      case 'http://example.com/':
      case 'http://example.com/foo':
      case 'http://test-realm/':
      case 'http://test-realm/test/':
      case 'http://test-realm/test2/':
      case 'http://test-realm/test/root/':
      case 'http://127.0.0.1:4447/':
        return 'test_realm';
      case 'http://127.0.0.1:4444/':
      case 'http://127.0.0.1:4445/':
      case 'http://127.0.0.1:4445/test/':
      case 'http://127.0.0.1:4446/demo/':
      case 'http://127.0.0.1:4448/':
        return 'node-test_realm';
    }
    throw new Error(
      `Cannot determine realm owner for realm ${this.realmURL.href}.`,
    );
  }
}

export function isIgnored(
  realmURL: URL,
  ignoreMap: Map<string, Ignore>,
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
  let ignoreURLs = [...ignoreMap.keys()];
  let matchingIgnores = ignoreURLs.filter((u) => url.href.includes(u));
  let ignoreURL = matchingIgnores.sort((a, b) => b.length - a.length)[0] as
    | string
    | undefined;
  if (!ignoreURL) {
    return false;
  }
  let ignore = ignoreMap.get(ignoreURL)!;
  let realmPath = new RealmPaths(realmURL);
  let pathname = realmPath.local(url);
  return ignore.test(pathname).ignored;
}
