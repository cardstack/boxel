import type * as JSONTypes from 'json-typescript';
import { parse } from 'date-fns';
import {
  authorizationMiddleware,
  maybeHandleScopedCSSRequest,
  RealmAuthDataSource,
  fetcher,
  RealmPaths,
  SupportedMimeType,
  fileContentToText,
  unixTime,
  logger,
  userIdFromUsername,
  type QueueRunner,
  type TextFileRef,
  type VirtualNetwork,
  type ResponseWithNodeStream,
  type Prerenderer,
  type IndexWriter,
  type QueuePublisher,
  type DBAdapter,
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

export class Worker {
  #log = logger('worker');
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
  #reportStatus: ((args: StatusArgs) => void) | undefined;
  #realmServerMatrixUsername;

  constructor({
    indexWriter,
    queue,
    dbAdapter,
    queuePublisher,
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
    this.#reportStatus = reportStatus;
    this.#realmServerMatrixUsername = realmServerMatrixUsername;
    this.#dbAdapter = dbAdapter;
    this.#queuePublisher = queuePublisher;
    this.#prerenderer = prerenderer;
  }

  async run() {
    let taskArgs: TaskArgs = {
      getReader,
      log: this.#log,
      matrixURL: this.#matrixURL.href,
      dbAdapter: this.#dbAdapter,
      indexWriter: this.#indexWriter,
      prerenderer: this.#prerenderer,
      queuePublisher: this.#queuePublisher,
      getAuthedFetch: this.makeAuthedFetch.bind(this),
      reportStatus: this.reportStatus.bind(this),
    };

    await Promise.all([
      this.#queue.register(
        `from-scratch-index`,
        Tasks['fromScratchIndex'](taskArgs),
      ),
      this.#queue.register(
        `incremental-index`,
        Tasks['incrementalIndex'](taskArgs),
      ),
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
        return next(req);
      },
      async (req, next) => {
        return (await maybeHandleScopedCSSRequest(req)) || next(req);
      },
      authorizationMiddleware(realmAuthDataSource),
    ]);
    return _fetch;
  }

  private reportStatus(args: JobInfo | undefined, status: 'start' | 'finish') {
    if (args?.jobId) {
      this.#reportStatus?.({ ...args, jobId: String(args.jobId), status });
    }
  }
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
