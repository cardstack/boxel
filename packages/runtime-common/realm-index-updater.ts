import { Memoize } from 'typescript-memoize';
import {
  IndexWriter,
  Deferred,
  logger,
  systemInitiatedPriority,
  userInitiatedPriority,
  type Stats,
  type DBAdapter,
  type QueuePublisher,
  type FromScratchArgs,
  type FromScratchResult,
  type IncrementalArgs,
  type IncrementalResult,
  type CopyArgs,
  type CopyResult,
  type Job,
} from '.';
import type { Realm } from './realm';
import { RealmPaths } from './paths';
import ignore, { type Ignore } from 'ignore';

export const FROM_SCRATCH_JOB_TIMEOUT_SEC = 20 * 60;
const INCREMENTAL_JOB_TIMEOUT_SEC = 10 * 60;

export class RealmIndexUpdater {
  #realm: Realm;
  #log = logger('realm-index-updater');
  #ignoreData: Record<string, string> = {};
  #stats: Stats = {
    instancesIndexed: 0,
    modulesIndexed: 0,
    instanceErrors: 0,
    moduleErrors: 0,
    definitionErrors: 0,
    definitionsIndexed: 0,
    totalIndexEntries: 0,
  };
  #indexWriter: IndexWriter;
  #queue: QueuePublisher;
  #indexingDeferred: Deferred<void> | undefined;

  constructor({
    realm,
    dbAdapter,
    queue,
  }: {
    realm: Realm;
    dbAdapter: DBAdapter;
    queue: QueuePublisher;
  }) {
    if (!dbAdapter) {
      throw new Error(
        `DB Adapter was not provided to SearchIndex constructor--this is required when using a db based index`,
      );
    }
    this.#indexWriter = new IndexWriter(dbAdapter);
    this.#queue = queue;
    this.#realm = realm;
  }

  get stats() {
    return this.#stats;
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

  indexing() {
    return this.#indexingDeferred?.promise;
  }

  // TODO consider triggering realm events for invalidations now that we can
  // calculate fine grained invalidations for from-scratch indexing by passing
  // in an onInvalidation callback
  async fullIndex() {
    this.#indexingDeferred = new Deferred<void>();
    let args: FromScratchArgs | undefined;
    let job: Job<FromScratchResult> | undefined;
    try {
      args = {
        realmURL: this.#realm.url,
        realmUsername: await this.#realm.getRealmOwnerUsername(),
      };
      job = await this.#queue.publish<FromScratchResult>({
        jobType: `from-scratch-index`,
        concurrencyGroup: `indexing:${this.#realm.url}`,
        timeout: FROM_SCRATCH_JOB_TIMEOUT_SEC,
        priority: systemInitiatedPriority,
        args,
      });
      let { ignoreData, stats } = await job.done;
      this.#stats = stats;
      this.#ignoreData = ignoreData;
      this.#log.info(
        `Realm ${this.realmURL.href} has completed indexing: ${JSON.stringify(
          stats,
          null,
          2,
        )}`,
      );
    } catch (e: any) {
      let jobDescriptor = job ? `job ${job.id}` : 'no job id recorded';
      let { summary, details } = describeIndexingError(e);
      this.#log.error(
        `Realm ${this.realmURL.href} from-scratch indexing failed (${jobDescriptor}): ${summary}`,
      );
      if (args) {
        let serializedArgs = safeJSONStringify(args);
        if (serializedArgs) {
          this.#log.error(
            `Realm ${this.realmURL.href} from-scratch indexing job payload:\n${serializedArgs}`,
          );
        }
      }
      if (details) {
        this.#log.error(
          `Realm ${this.realmURL.href} from-scratch indexing error payload:\n${details}`,
        );
      }
    } finally {
      this.#indexingDeferred.fulfill();
    }
  }

  async update(
    urls: URL[],
    opts?: { delete?: true; onInvalidation?: (invalidatedURLs: URL[]) => void },
  ): Promise<void> {
    this.#indexingDeferred = new Deferred<void>();
    try {
      let args: IncrementalArgs = {
        urls: urls.map((u) => u.href),
        realmURL: this.#realm.url,
        realmUsername: await this.#realm.getRealmOwnerUsername(),
        operation: opts?.delete ? 'delete' : 'update',
        ignoreData: { ...this.#ignoreData },
      };
      let job = await this.#queue.publish<IncrementalResult>({
        jobType: `incremental-index`,
        concurrencyGroup: `indexing:${this.#realm.url}`,
        timeout: INCREMENTAL_JOB_TIMEOUT_SEC,
        priority: userInitiatedPriority,
        args,
      });
      let { invalidations, ignoreData, stats } = await job.done;
      this.#stats = stats;
      this.#ignoreData = ignoreData;
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

  async copy(
    sourceRealmURL: URL,
    onInvalidation?: (invalidatedURLs: URL[]) => void,
  ): Promise<void> {
    this.#indexingDeferred = new Deferred<void>();
    try {
      let args: CopyArgs = {
        realmURL: this.#realm.url,
        realmUsername: await this.#realm.getRealmOwnerUsername(),
        sourceRealmURL: sourceRealmURL.href,
      };
      let job = await this.#queue.publish<CopyResult>({
        jobType: 'copy-index',
        concurrencyGroup: `indexing:${this.#realm.url}`,
        timeout: 4 * 60,
        priority: userInitiatedPriority,
        args,
      });
      let { invalidations } = await job.done;
      if (onInvalidation) {
        onInvalidation(
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
}

function safeJSONStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return undefined;
  }
}

function describeIndexingError(error: unknown): {
  summary: string;
  details?: string;
} {
  if (error instanceof Error) {
    return {
      summary: error.stack ?? `${error.name}: ${error.message}`,
    };
  }
  if (error && typeof error === 'object') {
    let message =
      typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : undefined;
    let serialized = safeJSONStringify(error);
    return {
      summary: message ?? serialized ?? Object.prototype.toString.call(error),
      details:
        serialized && serialized !== message
          ? serialized
          : undefined,
    };
  }
  return {
    summary: String(error),
  };
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
