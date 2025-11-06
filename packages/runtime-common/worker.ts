import type * as JSONTypes from 'json-typescript';
import { parse } from 'date-fns';
import type { IndexWriter, QueuePublisher, DBAdapter } from '.';
import {
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
  userIdFromUsername,
  type QueueRunner,
  type TextFileRef,
  type VirtualNetwork,
  type ResponseWithNodeStream,
  type Prerenderer,
  type RealmPermissions,
  fetchUserPermissions,
} from '.';
import { MatrixClient } from './matrix-client';
import * as Tasks from './tasks';
import type { WorkerArgs, TaskArgs } from './tasks';

export interface Stats extends JSONTypes.Object {
  instancesIndexed: number;
  modulesIndexed: number;
  definitionsIndexed: number;
  instanceErrors: number;
  moduleErrors: number;
  definitionErrors: number;
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

export interface StatusArgs {
  jobId?: string;
  status: 'start' | 'finish';
  realm?: string;
  url?: string;
  deps?: string[];
}

export type RunnerRegistration = (
  fromScratch: (args: FromScratchArgsWithPermissions) => Promise<IndexResults>,
  incremental: (args: IncrementalArgsWithPermissions) => Promise<IndexResults>,
) => Promise<void>;

export interface RunnerOpts {
  _fetch: typeof fetch;
  reader: Reader;
  prerenderer: Prerenderer;
  registerRunner: RunnerRegistration;
  indexWriter: IndexWriter;
  jobInfo?: JobInfo;
  reportStatus?(args: StatusArgs): void;
}

export interface IncrementalArgs extends WorkerArgs {
  urls: string[];
  operation: 'update' | 'delete';
  ignoreData: Record<string, string>;
}

export type IncrementalArgsWithPermissions = IncrementalArgs & {
  permissions: RealmPermissions;
};

export interface IncrementalResult {
  invalidations: string[];
  ignoreData: Record<string, string>;
  stats: Stats;
}

export type FromScratchArgs = WorkerArgs;

export type FromScratchArgsWithPermissions = FromScratchArgs & {
  permissions: RealmPermissions;
};

export interface FromScratchResult extends JSONTypes.Object {
  ignoreData: Record<string, string>;
  stats: Stats;
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
  #dbAdapter: DBAdapter;
  #prerenderer: Prerenderer;
  #queuePublisher: QueuePublisher;
  #virtualNetwork: VirtualNetwork;
  #matrixURL: URL;
  #matrixClientCache: Map<string, MatrixClient> = new Map();
  #realmAuthCache: Map<string, RealmAuthDataSource> = new Map();
  #secretSeed: string;
  #fromScratch:
    | ((
        args: FromScratchArgsWithPermissions & { boom?: true },
      ) => Promise<IndexResults>)
    | undefined;
  #incremental:
    | ((args: IncrementalArgsWithPermissions) => Promise<IndexResults>)
    | undefined;
  #reportStatus: ((args: StatusArgs) => void) | undefined;
  #realmServerMatrixUsername;

  constructor({
    indexWriter,
    queue,
    dbAdapter,
    queuePublisher,
    indexRunner,
    runnerOptsManager,
    virtualNetwork,
    matrixURL,
    realmServerMatrixUsername,
    secretSeed,
    reportStatus,
    prerenderer,
  }: {
    indexWriter: IndexWriter;
    queue: QueueRunner;
    dbAdapter: DBAdapter;
    queuePublisher: QueuePublisher;
    indexRunner: IndexRunner;
    runnerOptsManager: RunnerOptionsManager;
    virtualNetwork: VirtualNetwork;
    matrixURL: URL;
    realmServerMatrixUsername: string;
    secretSeed: string;
    prerenderer: Prerenderer;
    reportStatus?: (args: StatusArgs) => void;
  }) {
    this.#queue = queue;
    this.#indexWriter = indexWriter;
    this.#virtualNetwork = virtualNetwork;
    this.#matrixURL = matrixURL;
    this.#secretSeed = secretSeed;
    this.runnerOptsMgr = runnerOptsManager;
    this.#runner = indexRunner;
    this.#reportStatus = reportStatus;
    this.#realmServerMatrixUsername = realmServerMatrixUsername;
    this.#dbAdapter = dbAdapter;
    this.#queuePublisher = queuePublisher;
    this.#prerenderer = prerenderer;
  }

  async run() {
    let taskArgs: TaskArgs = {
      dbAdapter: this.#dbAdapter,
      queuePublisher: this.#queuePublisher,
      indexWriter: this.#indexWriter,
      log: this.#log,
      getAuthedFetch: this.makeAuthedFetch.bind(this),
      reportStatus: this.reportStatus.bind(this),
    };
    await Promise.all([
      this.#queue.register(`from-scratch-index`, this.fromScratch),
      this.#queue.register(`incremental-index`, this.incremental),
      this.#queue.register(`copy-index`, Tasks['copy'](taskArgs)),
      this.#queue.register(`lint-source`, Tasks['lintSource'](taskArgs)),
      this.#queue.register(
        Tasks.FULL_REINDEX_BATCH_JOB,
        Tasks['fullReindexBatch'](taskArgs),
      ),
      this.#queue.register(`full-reindex`, Tasks['fullReindex'](taskArgs)),
    ]);
    await this.#queue.start();
  }

  private async makeAuthedFetch(args: WorkerArgs) {
    let matrixClient: MatrixClient;
    if (this.#matrixClientCache.has(this.#realmServerMatrixUsername)) {
      matrixClient = this.#matrixClientCache.get(
        this.#realmServerMatrixUsername,
      )!;

      if (!(await matrixClient.isTokenValid())) {
        await matrixClient.login();
      }
    } else {
      matrixClient = new MatrixClient({
        matrixURL: new URL(this.#matrixURL),
        username: this.#realmServerMatrixUsername,
        seed: this.#secretSeed,
      });

      this.#matrixClientCache.set(
        this.#realmServerMatrixUsername,
        matrixClient,
      );
    }

    let _fetch: typeof globalThis.fetch | undefined;
    function getFetch() {
      return _fetch!;
    }
    let realmAuthDataSource = this.#realmAuthCache.get(args.realmURL);
    if (!realmAuthDataSource) {
      realmAuthDataSource = new RealmAuthDataSource(matrixClient, getFetch);
      this.#realmAuthCache.set(args.realmURL, realmAuthDataSource);
    }
    let realmUserId = userIdFromUsername(
      args.realmUsername,
      this.#matrixURL.href,
    );
    _fetch = fetcher(this.#virtualNetwork.fetch, [
      async (req, next) => {
        req.headers.set('X-Boxel-Building-Index', 'true');
        req.headers.set('X-Boxel-Assume-User', realmUserId);
        req.headers.set('X-Boxel-Disable-Module-Cache', 'true');
        return next(req);
      },
      // TODO do we need this in our indexer?
      async (req, next) => {
        return (await maybeHandleScopedCSSRequest(req)) || next(req);
      },
      authorizationMiddleware(realmAuthDataSource),
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
      reader: getReader(_fetch, args.realmURL),
      indexWriter: this.#indexWriter,
      reportStatus: this.#reportStatus,
      prerenderer: this.#prerenderer,
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
    try {
      // the result needs to be safe to stringify
      // so we check for issues here where we can gracefully handle it
      JSON.stringify(result);
    } catch (e: any) {
      this.#log.error(
        `${jobIdentity(args.jobInfo)} Unable to stringify the job result`,
        e,
      );
      throw e;
    }
    this.runnerOptsMgr.removeOptions(optsId);
    return result;
  }

  private reportStatus(
    jobInfo: JobInfo | undefined,
    status: 'start' | 'finish',
  ) {
    if (jobInfo?.jobId) {
      this.#reportStatus?.({ jobId: String(jobInfo.jobId), status });
    }
  }

  // TODO this is the legacy fromScratch task that depends on FastBoot, this
  // will eventually get removed
  private fromScratch = async (
    args: FromScratchArgs & { jobInfo?: JobInfo },
  ) => {
    this.#log.debug(
      `${jobIdentity(args.jobInfo)} starting from-scratch indexing for job: ${JSON.stringify(args)}`,
    );
    this.reportStatus(args.jobInfo, 'start');
    return await this.prepareAndRunJob<FromScratchResult>(args, async () => {
      if (!this.#fromScratch) {
        throw new Error(`Index runner has not been registered`);
      }
      let realmUserId = userIdFromUsername(
        args.realmUsername,
        this.#matrixURL.href,
      );
      let permissions = await fetchUserPermissions(this.#dbAdapter, {
        userId: realmUserId,
      });
      let { ignoreData, stats } = await this.#fromScratch({
        ...args,
        realmUsername: realmUserId, // we fashion JWT from this which needs to be full matrix userid
        permissions,
      });
      this.#log.debug(
        `${jobIdentity(args.jobInfo)} completed from-scratch indexing for realm ${
          args.realmURL
        }:\n${JSON.stringify(stats, null, 2)}`,
      );
      this.reportStatus(args.jobInfo, 'finish');
      return {
        ignoreData: { ...ignoreData },
        stats,
      };
    });
  };

  // TODO this is the legacy incremental task that depends on FastBoot, this
  // will eventually get removed
  private incremental = async (
    args: IncrementalArgs & { jobInfo?: JobInfo },
  ) => {
    this.#log.debug(
      `${jobIdentity(args.jobInfo)} starting incremental indexing for job: ${JSON.stringify(args)}`,
    );
    this.reportStatus(args.jobInfo, 'start');
    return await this.prepareAndRunJob<IncrementalResult>(args, async () => {
      if (!this.#incremental) {
        throw new Error(`Index runner has not been registered`);
      }
      let realmUserId = userIdFromUsername(
        args.realmUsername,
        this.#matrixURL.href,
      );
      let permissions = await fetchUserPermissions(this.#dbAdapter, {
        userId: realmUserId,
      });
      let { ignoreData, stats, invalidations } = await this.#incremental({
        ...args,
        realmUsername: realmUserId, // we fashion JWT from this which needs to be full matrix userid
        permissions,
      });
      this.#log.debug(
        `${jobIdentity(args.jobInfo)} completed incremental indexing for  ${args.urls.join()}:\n${JSON.stringify(
          { ...stats, invalidations },
          null,
          2,
        )}`,
      );
      this.reportStatus(args.jobInfo, 'finish');
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
  realmURL: string,
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
      let path = new RealmPaths(new URL(realmURL)).local(url);
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
      let response = await _fetch(`${realmURL}_mtimes`, {
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
