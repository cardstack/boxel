import * as JSONTypes from 'json-typescript';
import { parse } from 'date-fns';
import {
  IndexWriter,
  Deferred,
  reportError,
  authorizationMiddleware,
  maybeHandleScopedCSSRequest,
  RealmAuthDataSource,
  fetcher,
  RealmPaths,
  SupportedMimeType,
  fileContentToText,
  unixTime,
  logger,
  jobIdentity,
  type QueueRunner,
  type TextFileRef,
  type VirtualNetwork,
  type ResponseWithNodeStream,
  type RealmInfo,
} from '.';
import { MatrixClient } from './matrix-client';
import { lintFix } from './lint';

export interface Stats extends JSONTypes.Object {
  instancesIndexed: number;
  modulesIndexed: number;
  instanceErrors: number;
  moduleErrors: number;
  totalIndexEntries: number;
}

export interface IndexResults {
  ignoreData: Record<string, string>;
  stats: Stats;
  invalidations: string[];
}

export interface Reader {
  readFile: (url: URL) => Promise<TextFileRef | undefined>;
  mtimes: () => Promise<{ [url: string]: number }>;
}

export interface JobInfo extends JSONTypes.Object {
  jobId: number;
  reservationId: number;
}

export type RunnerRegistration = (
  fromScratch: (realmURL: URL) => Promise<IndexResults>,
  incremental: (
    urls: URL[],
    realmURL: URL,
    operation: 'update' | 'delete',
    ignoreData: Record<string, string>,
  ) => Promise<IndexResults>,
) => Promise<void>;

export interface RunnerOpts {
  _fetch: typeof fetch;
  reader: Reader;
  registerRunner: RunnerRegistration;
  indexWriter: IndexWriter;
  jobInfo?: JobInfo;
}

export interface WorkerArgs extends JSONTypes.Object {
  realmURL: string;
  realmUsername: string;
}

export interface IncrementalArgs extends WorkerArgs {
  urls: string[];
  operation: 'update' | 'delete';
  ignoreData: Record<string, string>;
}

export interface IncrementalResult {
  invalidations: string[];
  ignoreData: Record<string, string>;
  stats: Stats;
}

export type FromScratchArgs = WorkerArgs;

export interface FromScratchResult extends JSONTypes.Object {
  ignoreData: Record<string, string>;
  stats: Stats;
}

export interface CopyArgs extends WorkerArgs {
  sourceRealmURL: string;
}

export interface CopyResult {
  totalNonErrorIndexEntries: number;
  invalidations: string[];
}

export type IndexRunner = (optsId: number) => Promise<void>;

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

export class Worker {
  #log = logger('worker');
  #runner: IndexRunner;
  runnerOptsMgr: RunnerOptionsManager;
  #indexWriter: IndexWriter;
  #queue: QueueRunner;
  #virtualNetwork: VirtualNetwork;
  #matrixURL: URL;
  #matrixClientCache: Map<string, MatrixClient> = new Map();
  #secretSeed: string;
  #fromScratch:
    | ((realmURL: URL, boom?: true) => Promise<IndexResults>)
    | undefined;
  #incremental:
    | ((
        urls: URL[],
        realmURL: URL,
        operation: 'update' | 'delete',
        ignoreData: Record<string, string>,
      ) => Promise<IndexResults>)
    | undefined;

  constructor({
    indexWriter,
    queue,
    indexRunner,
    runnerOptsManager,
    virtualNetwork,
    matrixURL,
    secretSeed,
  }: {
    indexWriter: IndexWriter;
    queue: QueueRunner;
    indexRunner: IndexRunner;
    runnerOptsManager: RunnerOptionsManager;
    virtualNetwork: VirtualNetwork;
    matrixURL: URL;
    secretSeed: string;
  }) {
    this.#queue = queue;
    this.#indexWriter = indexWriter;
    this.#virtualNetwork = virtualNetwork;
    this.#matrixURL = matrixURL;
    this.#secretSeed = secretSeed;
    this.runnerOptsMgr = runnerOptsManager;
    this.#runner = indexRunner;
  }

  async run() {
    await Promise.all([
      this.#queue.register(`from-scratch-index`, this.fromScratch),
      this.#queue.register(`incremental-index`, this.incremental),
      this.#queue.register(`copy-index`, this.copy),
      this.#queue.register(`lint-source`, lintFix),
    ]);
    await this.#queue.start();
  }

  private async makeAuthedFetch(args: WorkerArgs) {
    let matrixClient: MatrixClient;
    if (this.#matrixClientCache.has(args.realmUsername)) {
      matrixClient = this.#matrixClientCache.get(args.realmUsername)!;

      if (!(await matrixClient.isTokenValid())) {
        await matrixClient.login();
      }
    } else {
      matrixClient = new MatrixClient({
        matrixURL: new URL(this.#matrixURL),
        username: args.realmUsername,
        seed: this.#secretSeed,
      });

      this.#matrixClientCache.set(args.realmUsername, matrixClient);
    }

    let _fetch: typeof globalThis.fetch | undefined;
    function getFetch() {
      return _fetch!;
    }
    _fetch = fetcher(this.#virtualNetwork.fetch, [
      async (req, next) => {
        req.headers.set('X-Boxel-Building-Index', 'true');
        return next(req);
      },
      // TODO do we need this in our indexer?
      async (req, next) => {
        return (await maybeHandleScopedCSSRequest(req)) || next(req);
      },
      authorizationMiddleware(new RealmAuthDataSource(matrixClient, getFetch)),
    ]);
    return _fetch;
  }

  private async prepareAndRunJob<T>(
    args: WorkerArgs & { jobInfo?: JobInfo },
    run: () => Promise<T>,
  ): Promise<T> {
    let deferred = new Deferred<T>();
    let _fetch = await this.makeAuthedFetch(args);
    let optsId = this.runnerOptsMgr.setOptions({
      _fetch,
      jobInfo: args.jobInfo,
      reader: getReader(_fetch, new URL(args.realmURL)),
      indexWriter: this.#indexWriter,
      registerRunner: async (fromScratch, incremental) => {
        this.#fromScratch = fromScratch;
        this.#incremental = incremental;
        try {
          let result = await run();
          deferred.fulfill(result);
        } catch (e: any) {
          // this exception is _very_ difficult to thread thru fastboot (a
          // `deferred.reject(e)` doesn't do the thing you'd expect). Presumably
          // the only kind of exceptions that get raised at this level would be
          // indexer DB issues. Let's just log in sentry here and let developers
          // followup on the issue from the sentry logs. Likely if an exception
          // was raised to this level the fastboot instance is probably no
          // longer usable.
          reportError(e);
          this.#log.error(
            `${jobIdentity(args.jobInfo)} Error raised during indexing has likely stopped the indexer`,
            e,
          );
          deferred.reject(
            new Error(
              'Rethrowing error from inside registerRunner: ' + e?.message,
            ),
          );
        }
      },
    });
    await this.#runner(optsId);
    let result = await deferred.promise;
    this.runnerOptsMgr.removeOptions(optsId);
    return result;
  }

  private copy = async (args: CopyArgs & { jobInfo?: JobInfo }) => {
    this.#log.debug(
      `${jobIdentity(args.jobInfo)} starting copy indexing for job: ${JSON.stringify(args)}`,
    );
    let authedFetch = await this.makeAuthedFetch(args);
    let realmInfoResponse = await authedFetch(`${args.realmURL}_info`, {
      headers: { Accept: SupportedMimeType.RealmInfo },
    });
    let realmInfo: RealmInfo = (await realmInfoResponse.json())?.data
      ?.attributes;

    let batch = await this.#indexWriter.createBatch(new URL(args.realmURL));
    await batch.copyFrom(new URL(args.sourceRealmURL), realmInfo);
    let result = await batch.done();
    let invalidations = batch.invalidations;
    this.#log.debug(
      `${jobIdentity(args.jobInfo)} completed copy indexing for realm ${args.realmURL}:\n${JSON.stringify(
        result,
        null,
        2,
      )}`,
    );
    let { totalIndexEntries: totalNonErrorIndexEntries } = result;
    return {
      invalidations,
      totalNonErrorIndexEntries,
    };
  };

  private fromScratch = async (
    args: FromScratchArgs & { jobInfo?: JobInfo },
  ) => {
    this.#log.debug(
      `${jobIdentity(args.jobInfo)} starting from-scratch indexing for job: ${JSON.stringify(args)}`,
    );
    return await this.prepareAndRunJob<FromScratchResult>(args, async () => {
      if (!this.#fromScratch) {
        throw new Error(`Index runner has not been registered`);
      }
      let { ignoreData, stats } = await this.#fromScratch(
        new URL(args.realmURL),
      );
      this.#log.debug(
        `${jobIdentity(args.jobInfo)} completed from-scratch indexing for realm ${
          args.realmURL
        }:\n${JSON.stringify(stats, null, 2)}`,
      );
      return {
        ignoreData: { ...ignoreData },
        stats,
      };
    });
  };

  private incremental = async (
    args: IncrementalArgs & { jobInfo?: JobInfo },
  ) => {
    this.#log.debug(
      `${jobIdentity(args.jobInfo)} starting incremental indexing for job: ${JSON.stringify(args)}`,
    );
    return await this.prepareAndRunJob<IncrementalResult>(args, async () => {
      if (!this.#incremental) {
        throw new Error(`Index runner has not been registered`);
      }
      let { ignoreData, stats, invalidations } = await this.#incremental(
        args.urls.map((u) => new URL(u)),
        new URL(args.realmURL),
        args.operation,
        { ...args.ignoreData },
      );
      this.#log.debug(
        `${jobIdentity(args.jobInfo)} completed incremental indexing for  ${args.urls.join()}:\n${JSON.stringify(
          { ...stats, invalidations },
          null,
          2,
        )}`,
      );
      return {
        ignoreData: { ...ignoreData },
        invalidations,
        stats,
      };
    });
  };
}

export function getReader(
  _fetch: typeof globalThis.fetch,
  realmURL: URL,
): Reader {
  return {
    readFile: async (url: URL) => {
      let response: ResponseWithNodeStream = await _fetch(url, {
        headers: {
          Accept: SupportedMimeType.CardSource,
        },
      });
      if (!response.ok) {
        return undefined;
      }
      let content: string;
      if ('nodeStream' in response && response.nodeStream) {
        content = await fileContentToText({
          content: response.nodeStream,
        });
      } else {
        content = await response.text();
      }
      let lastModifiedRfc7321 = response.headers.get('last-modified');
      if (!lastModifiedRfc7321) {
        throw new Error(
          `Response for ${url.href} has no 'last-modified' header`,
        );
      }
      // This is RFC-7321 format which is the last modified date format used in HTTP headers
      let lastModified = unixTime(
        parse(
          lastModifiedRfc7321.replace(/ GMT$/, 'Z'),
          'EEE, dd MMM yyyy HH:mm:ssX',
          new Date(),
        ).getTime(),
      );

      let createdRfc7321 = response.headers.get('x-created');
      let created: number;
      if (createdRfc7321) {
        created = unixTime(
          parse(
            createdRfc7321.replace(/ GMT$/, 'Z'),
            'EEE, dd MMM yyyy HH:mm:ssX',
            new Date(),
          ).getTime(),
        );
      } else {
        created = lastModified; // Default created to lastModified if no created header is present
      }
      let path = new RealmPaths(realmURL).local(url);
      return {
        content,
        lastModified,
        created,
        path,
        ...(Symbol.for('shimmed-module') in response ||
        response.headers.get('X-Boxel-Shimmed-Module')
          ? { isShimmed: true }
          : {}),
      };
    },

    mtimes: async () => {
      let response = await _fetch(`${realmURL.href}_mtimes`, {
        headers: {
          Accept: SupportedMimeType.Mtimes,
        },
      });
      let {
        data: {
          attributes: { mtimes },
        },
      } = (await response.json()) as {
        data: { attributes: { mtimes: { [url: string]: number } } };
      };
      return mtimes;
    },
  };
}
