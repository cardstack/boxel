import type * as JSONTypes from 'json-typescript';
import { Readable } from 'stream';
import { parse } from 'date-fns';
import {
  authorizationMiddleware,
  maybeHandleScopedCSSRequest,
  RealmAuthDataSource,
  fetcher,
  RealmPaths,
  SupportedMimeType,
  fileContentToText,
  fileContentToBytes,
  unixTime,
  logger,
  userIdFromUsername,
  type ByteStream,
  type QueueRunner,
  type TextFileRef,
  type VirtualNetwork,
  type ResponseWithNodeStream,
  type Prerenderer,
  type IndexWriter,
  type QueuePublisher,
  type DBAdapter,
  type RealmPermissions,
} from '.';
import { MatrixClient } from './matrix-client';
import * as Tasks from './tasks';
import type { WorkerArgs, TaskArgs } from './tasks';

export interface Stats extends JSONTypes.Object {
  instancesIndexed: number;
  modulesIndexed: number;
  instanceErrors: number;
  moduleErrors: number;
  totalIndexEntries: number;
}

export interface Reader {
  readFile: (url: URL) => Promise<TextFileRef | undefined>;
  readStream: (url: URL) => Promise<StreamFileRef | undefined>;
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
  #createPrerenderAuth: (
    userId: string,
    permissions: RealmPermissions,
  ) => string;

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
    createPrerenderAuth,
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
    createPrerenderAuth: (
      userId: string,
      permissions: RealmPermissions,
    ) => string;
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
    this.#createPrerenderAuth = createPrerenderAuth;
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
      createPrerenderAuth: this.#createPrerenderAuth,
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
      this.#queue.register(`full-reindex`, Tasks['fullReindex'](taskArgs)),
      this.#queue.register(
        `daily-credit-grant`,
        Tasks['dailyCreditGrant'](taskArgs),
      ),
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
  let parseResponseMetadata = (
    response: Response,
    url: URL,
  ): { lastModified: number; created: number; path: string } => {
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
    return { lastModified, created, path };
  };

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
      let { lastModified, created, path } = parseResponseMetadata(
        response,
        url,
      );
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

    readStream: async (url: URL) => {
      let response: ResponseWithNodeStream = await _fetch(url, {
        headers: {
          Accept: SupportedMimeType.CardSource,
        },
      });
      if (!response.ok) {
        return undefined;
      }

      let stream: ByteStream;
      if ('nodeStream' in response && response.nodeStream) {
        if (Readable.toWeb) {
          stream = Readable.toWeb(response.nodeStream) as ReadableStream<Uint8Array>;
        } else {
          stream = await fileContentToBytes({
            content: response.nodeStream,
          });
        }
      } else if (response.body) {
        stream = response.body;
      } else {
        stream = new Uint8Array();
      }

      let { lastModified, created, path } = parseResponseMetadata(
        response,
        url,
      );
      return {
        stream,
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
      if (!response.ok) {
        let responseText = '';
        try {
          responseText = await response.text();
        } catch {
          responseText = '';
        }
        let details = responseText ? `: ${responseText}` : '';
        console.warn(
          `mtimes request failed for ${realmURL}_mtimes (${response.status} ${response.statusText})${details}`,
        );
        return {};
      }
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

export interface StreamFileRef {
  stream: ByteStream;
  lastModified: number;
  created: number;
  path: string;
  isShimmed?: true;
}
