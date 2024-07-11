import { Memoize } from 'typescript-memoize';
import {
  IndexWriter,
  type Stats,
  type DBAdapter,
  type Queue,
  type FromScratchArgs,
  type FromScratchResult,
  type IncrementalArgs,
  type IncrementalResult,
} from '.';
import { Realm } from './realm';
import { RealmPaths } from './paths';
import { Loader } from './loader';
import ignore, { type Ignore } from 'ignore';

export class RealmIndexUpdater {
  #realm: Realm;
  #loader: Loader;
  #ignoreData: Record<string, string> = {};
  #stats: Stats = {
    instancesIndexed: 0,
    instanceErrors: 0,
    moduleErrors: 0,
  };
  #indexWriter: IndexWriter;
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
    this.#indexWriter = new IndexWriter(dbAdapter);
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
    let ignoreMap = new Map<string, Ignore>();
    for (let [url, contents] of Object.entries(this.#ignoreData)) {
      ignoreMap.set(url, ignore().add(contents));
    }
    return ignoreMap;
  }

  async run(onIndexWriterReady?: (indexWriter: IndexWriter) => Promise<void>) {
    await this.#queue.start();
    if (onIndexWriterReady) {
      await onIndexWriterReady(this.#indexWriter);
    }

    await this.fullIndex();
  }

  async fullIndex() {
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
