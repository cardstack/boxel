import type * as JSONTypes from 'json-typescript';
import type { Readable as NodeReadable } from 'stream';
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
  CachingDefinitionLookup,
} from './index.ts';
import { MatrixClient } from './matrix-client.ts';
import type { MediaCacheAdapter } from './media-cache.ts';
import * as Tasks from './tasks/index.ts';
import type { WorkerArgs, TaskArgs } from './tasks/index.ts';
import type { RealmEventContent } from '@cardstack/base/matrix-event';
import { heartbeatJob } from './queue.ts';

export interface Stats extends JSONTypes.Object {
  instancesIndexed: number;
  filesIndexed: number;
  instanceErrors: number;
  fileErrors: number;
  totalIndexEntries: number;
}

// Wall-clock of each phase of an index job outside the per-row server render.
// Populated by the IndexRunner and returned alongside `stats` on the job
// result (persisted to `jobs.result.phaseTimings`), so the ~one-in-four of the
// job wall that falls between server renders decomposes into measured buckets.
// The per-row server render and per-visit client overhead
// (`boxel_index.diagnostics`) account for the rest. Kept off `Stats` — which is
// a `JSONTypes.Object` embedded in other job results and deep-compared in
// tests — so it carries no non-deterministic timing there. All fields
// optional: incremental jobs skip the from-scratch-only phases (mtimes read,
// module pre-warm), and any phase that didn't run stays absent.
export interface IndexPhaseTimings {
  // Whole-job wall, kickoff to return.
  totalMs?: number;
  // Batch setup before any phase below: `IndexWriter.createBatch` (generation
  // read + resumable pending-row scan). Non-trivial on a retry job or under DB
  // slowness, so it's bucketed rather than left as residue in `totalMs`.
  setupMs?: number;
  // Reading the index's per-file modified times up front (from-scratch only).
  mtimesMs?: number;
  // Invalidation discovery: the from-scratch filesystem walk, or the
  // incremental invalidation fan-out.
  discoverMs?: number;
  // Ordering the invalidation set by dependency so files precede the cards
  // that consume them.
  orderMs?: number;
  // The whole serial visit loop wall. Equals Σ server render
  // (`boxel_index.diagnostics.totalElapsedMs`) + Σ per-visit
  // `indexVisitClientMs` + `writeMs`.
  visitLoopMs?: number;
  // Aggregate row-write time across the loop — the Σ of every
  // `batch.updateEntry` INSERT. Tracked here rather than per row because a row
  // cannot time its own write. This is the I/O the visit's tab does not need,
  // so it is the primary candidate to overlap with the next visit.
  writeMs?: number;
  // The final atomic swap: `batch.done()` (realm-meta update, pending → main
  // promotion, obsolete-row prune) in one transaction, then the cleanup of
  // the pending rows it promoted. Excludes `validationMs`.
  swapMs?: number;
  // How many times the swap's transaction ran. More than 1 means a deadlock
  // or serialization failure against a concurrent commit to the same rows
  // rolled it back and it ran again.
  swapAttempts?: number;
  // The part of `swapMs` spent on attempts that rolled back.
  swapRetryMs?: number;
  // The part of `swapMs` the committing attempt spent waiting for the realm's
  // commit lock — for another pass of the same realm to finish committing.
  commitLockWaitMs?: number;
  // The part of `swapMs` after the commit spent deleting the pending rows it
  // promoted and running the janitor. Absent when the swap never committed.
  pendingCleanupMs?: number;
  // What the janitor removed: this realm's pending rows no pass can commit any
  // more — those of jobs that have finished, and ad-hoc stagings idle past
  // the abandonment window — and how many stagings they belonged to. Nonzero
  // means some pass left rows behind: it died before its commit, or its own
  // cleanup failed. Absent when the cleanup failed before the janitor ran.
  janitorRowsCleared?: number;
  janitorStagingsCleared?: number;
  // Present only when a peer pass of the realm committed while this one ran,
  // so its commit checked what the peer's commit made stale. `validationMs`
  // is the wall of those checks plus every round that rolled the commit back
  // to re-visit. `validationRounds` counts the rounds: 0 means the peers
  // touched nothing this pass read. `revisitCount` is the URLs the rounds
  // re-visited, and `extendCount` the peer-committed URLs the pass extended
  // to because they depend on it, both summed across rounds. Each re-visited
  // row carries its round as `boxel_index.diagnostics.validationRound`.
  validationMs?: number;
  validationRounds?: number;
  revisitCount?: number;
  extendCount?: number;
  // The `incremental-index` job the commit enqueued in its own transaction,
  // when the rounds ran out and peers still left rows stale. It re-indexes
  // what was left, in the pass's lane.
  followUpJobId?: number;
}

export interface StreamFileRef {
  stream: ByteStream;
  lastModified: number;
  created: number;
  path: string;
  isShimmed?: true;
}

export interface Reader {
  readFile: (url: URL) => Promise<TextFileRef | undefined>;
  readStream: (url: URL) => Promise<StreamFileRef | undefined>;
  mtimes: () => Promise<{ [url: string]: number }>;
}

export interface JobInfo extends JSONTypes.Object {
  jobId: number;
  reservationId: number;
  // Priority of the job this handler is running for, threaded from
  // the queue row (the tier constants live in `queue.ts`). Forwarded
  // into the prerenderer call chain so the prerender server can route
  // by priority. Required because
  // `JSONTypes.Object`'s index signature doesn't accept `undefined`;
  // the queue layer always supplies the value from the row, and tests
  // / non-job callers that mint a synthetic JobInfo can pass
  // `priority: 0`.
  priority: number;
  // Enqueue → reservation claim, measured against the database clock at
  // claim time (the same value the queue's starting-job log line reports).
  // Lets a handler attribute queue wait in its own telemetry without
  // re-querying the jobs table. `| null` rather than `?:` for the same
  // index-signature reason as `priority`; null means the queue couldn't
  // compute it (or the JobInfo is synthetic).
  queueWaitMs: number | null;
  // The lane the job was claimed in, and the lane family it belongs to, as the
  // queue row records them. Together with `queueWaitMs` they say what a job
  // waited behind: another job of its own lane, or the family's exclusive work
  // (see `QueuePublishRequest.laneFamily`). Null on a synthetic JobInfo, and
  // `laneFamily` is null on any job published without a family.
  concurrencyGroup: string | null;
  laneFamily: string | null;
}

// The claim-time facts an index or prerender-html job persists about itself, on
// `jobs.result.queueClaim` and on every row it writes, under
// `diagnostics.queueClaim`. Absent for a JobInfo no queue claim produced.
export interface QueueClaim extends JSONTypes.Object {
  queueWaitMs: number | null;
  concurrencyGroup: string | null;
  laneFamily: string | null;
}

export function queueClaimOf(
  jobInfo: JobInfo | undefined,
): QueueClaim | undefined {
  if (!jobInfo || jobInfo.jobId < 0) {
    return undefined;
  }
  return {
    queueWaitMs: jobInfo.queueWaitMs,
    concurrencyGroup: jobInfo.concurrencyGroup ?? null,
    laneFamily: jobInfo.laneFamily ?? null,
  };
}

export interface StatusArgs {
  jobId?: string;
  status: 'start' | 'finish';
  realm?: string;
  url?: string;
  deps?: string[];
}

export interface IndexingProgressEvent {
  type: 'indexing-started' | 'file-visited' | 'indexing-finished';
  realmURL: string;
  jobId: number;
  // The reservation the reporting job holds. Carried so a progress report can
  // double as the job's heartbeat: the queue keys heartbeats by reservation,
  // because a job id can have more than one over its life. Optional for
  // callers that mint a synthetic event without a reservation behind it.
  reservationId?: number;
  jobType?: string;
  totalFiles?: number;
  filesCompleted?: number;
  files?: string[];
  url?: string;
  stats?: Stats;
  // The lane the job was claimed in (its `concurrency_group`), on
  // `indexing-started` and `indexing-finished`, so a job's progress log lines
  // say whose pass it is: a writer's lane, the owner's, or the family's
  // exclusive lane. Absent when no queue claimed the job.
  lane?: string;
}

// `IndexingProgressEvent.lane` for a job, spread into the event.
export function progressLaneOf(jobInfo: JobInfo | undefined): {
  lane?: string;
} {
  return jobInfo?.concurrencyGroup ? { lane: jobInfo.concurrencyGroup } : {};
}

// The job types an `indexJobsOnly` worker registers. The queue's claim
// query only dequeues job types a worker has registered handlers for, so
// restricting registration is what makes such a worker an indexing-only
// lane: it can never be held by a prerender-html sweep (or any other job
// type), no matter how the priority tiers are configured.
export const INDEX_JOB_TYPES = [
  'from-scratch-index',
  'incremental-index',
  'copy-index',
] as const;

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
  #reportProgress: ((event: IndexingProgressEvent) => void) | undefined;
  #reportRealmEvent: ((event: RealmEventContent) => void) | undefined;
  #realmServerMatrixUsername;
  #indexJobsOnly: boolean;
  #skipPrerenderHtmlRealms: string[];
  #mediaCacheAdapter: MediaCacheAdapter | undefined;
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
    reportProgress,
    reportRealmEvent,
    prerenderer,
    createPrerenderAuth,
    indexJobsOnly,
    skipPrerenderHtmlRealms,
    mediaCacheAdapter,
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
    reportProgress?: (event: IndexingProgressEvent) => void;
    reportRealmEvent?: (event: RealmEventContent) => void;
    // When true, register handlers only for INDEX_JOB_TYPES so this worker
    // is a dedicated indexing lane — see INDEX_JOB_TYPES above.
    indexJobsOnly?: boolean;
    skipPrerenderHtmlRealms?: string[];
    // The MediaCache object store, absent when the process has none
    // configured (media-cache tasks then no-op).
    mediaCacheAdapter?: MediaCacheAdapter;
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
    this.#reportProgress = reportProgress;
    this.#reportRealmEvent = reportRealmEvent;
    this.#realmServerMatrixUsername = realmServerMatrixUsername;
    this.#dbAdapter = dbAdapter;
    this.#queuePublisher = queuePublisher;
    this.#prerenderer = prerenderer;
    this.#createPrerenderAuth = createPrerenderAuth;
    this.#indexJobsOnly = indexJobsOnly ?? false;
    this.#skipPrerenderHtmlRealms = skipPrerenderHtmlRealms ?? [];
    this.#mediaCacheAdapter = mediaCacheAdapter;
  }

  async run() {
    let definitionLookup = new CachingDefinitionLookup(
      this.#dbAdapter,
      this.#prerenderer,
      this.#virtualNetwork,
      this.#createPrerenderAuth,
    );
    let taskArgs: TaskArgs = {
      getReader,
      log: this.#log,
      matrixURL: this.#matrixURL.href,
      dbAdapter: this.#dbAdapter,
      indexWriter: this.#indexWriter,
      prerenderer: this.#prerenderer,
      definitionLookup,
      virtualNetwork: this.#virtualNetwork,
      queuePublisher: this.#queuePublisher,
      getAuthedFetch: this.makeAuthedFetch.bind(this),
      reportStatus: this.reportStatus.bind(this),
      reportProgress: this.reportProgress.bind(this),
      reportRealmEvent: this.reportRealmEvent.bind(this),
      createPrerenderAuth: this.#createPrerenderAuth,
      mediaCacheAdapter: this.#mediaCacheAdapter,
      skipPrerenderHtmlRealms: this.#skipPrerenderHtmlRealms,
    };

    let registrations: Record<string, () => Promise<unknown> | unknown> = {
      'from-scratch-index': () =>
        this.#queue.register(
          `from-scratch-index`,
          Tasks['fromScratchIndex'](taskArgs),
        ),
      'incremental-index': () =>
        this.#queue.register(
          `incremental-index`,
          Tasks['incrementalIndex'](taskArgs),
        ),
      prerender_html: () =>
        this.#queue.register(
          `prerender_html`,
          Tasks['prerenderHtml'](taskArgs),
        ),
      'prerender-html-reconcile': () =>
        this.#queue.register(
          `prerender-html-reconcile`,
          Tasks['prerenderHtmlReconcile'](taskArgs),
        ),
      'media-cache-gc': () =>
        this.#queue.register(`media-cache-gc`, Tasks['mediaCacheGc'](taskArgs)),
      'scoped-css-gc': () =>
        this.#queue.register(`scoped-css-gc`, Tasks['scopedCssGc'](taskArgs)),
      'copy-index': () =>
        this.#queue.register(`copy-index`, Tasks['copy'](taskArgs)),
      'lint-source': () =>
        this.#queue.register(`lint-source`, Tasks['lintSource'](taskArgs)),
      'full-reindex': () =>
        this.#queue.register(`full-reindex`, Tasks['fullReindex'](taskArgs)),
      'daily-credit-grant': () =>
        this.#queue.register(
          `daily-credit-grant`,
          Tasks['dailyCreditGrant'](taskArgs),
        ),
      'run-command': () =>
        this.#queue.register(`run-command`, Tasks['runCommand'](taskArgs)),
      'screenshot-card': () =>
        this.#queue.register(
          `screenshot-card`,
          Tasks['screenshotCard'](taskArgs),
        ),
    };
    let jobTypes = this.#indexJobsOnly
      ? (INDEX_JOB_TYPES as readonly string[])
      : Object.keys(registrations);
    await Promise.all(jobTypes.map((jobType) => registrations[jobType]()));
    await this.#queue.start();
  }

  private async makeAuthedFetch(args: WorkerArgs) {
    let matrixClient: MatrixClient;
    if (this.#matrixClientCache.has(this.#realmServerMatrixUsername)) {
      matrixClient = this.#matrixClientCache.get(
        this.#realmServerMatrixUsername,
      )!;

      try {
        if (!(await matrixClient.isTokenValid())) {
          await matrixClient.login();
        }
      } catch (e) {
        this.#log.warn(
          `Failed to validate/refresh matrix token, proceeding without pre-authenticated token`,
          e,
        );
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
    _fetch = fetcher(
      this.#virtualNetwork.fetch,
      [
        async (req, next) => {
          req.headers.set('X-Boxel-Assume-User', realmUserId);
          return next(req);
        },
        async (req, next) => {
          return (await maybeHandleScopedCSSRequest(req)) || next(req);
        },
        authorizationMiddleware(realmAuthDataSource),
      ],
      this.#virtualNetwork,
    );
    return _fetch;
  }

  private reportStatus(args: JobInfo | undefined, status: 'start' | 'finish') {
    if (args?.jobId) {
      this.#reportStatus?.({ ...args, jobId: String(args.jobId), status });
    }
  }

  private reportProgress(event: IndexingProgressEvent) {
    // Progress is also the job's proof of life. Telling the queue here — at
    // the one place every progress report already passes through — is what
    // lets a long pass keep its worker: its deadline measures silence, and
    // this is the job breaking it.
    heartbeatJob(event.reservationId);
    this.#reportProgress?.(event);
  }

  private reportRealmEvent(event: RealmEventContent) {
    this.#reportRealmEvent?.(event);
  }
}

export function getReader(
  _fetch: typeof globalThis.fetch,
  realmURL: string,
): Reader {
  let readerLog = logger('worker');
  let parseResponseMetadata = (
    response: Response,
    url: URL,
  ): { lastModified: number; created: number; path: string } => {
    let lastModifiedRfc7321 = response.headers.get('last-modified');
    if (!lastModifiedRfc7321) {
      throw new Error(`Response for ${url.href} has no 'last-modified' header`);
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
      try {
        if ('nodeStream' in response && response.nodeStream) {
          content = await fileContentToText({
            content: response.nodeStream,
          });
        } else {
          content = await response.text();
        }
      } catch (err: any) {
        // An in-process realm serves file bodies as lazy node streams: the
        // realm checks existence when it builds the response, but the
        // underlying open() happens only when we consume the body here. A
        // file deleted in that window surfaces as an ENOENT on the body
        // read even though the response itself was ok. That is a
        // not-found, same as the !response.ok branch above — callers
        // already treat undefined as "file no longer exists".
        if (err?.code === 'ENOENT') {
          readerLog.info(
            `file ${url.href} disappeared while reading its body (ENOENT); treating as not found`,
          );
          return undefined;
        }
        throw err;
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
        // Lazy-load node stream in the node worker path; browsers never hit
        // this branch (no response.nodeStream) and don't need the module.
        let { Readable } = (await import('stream')) as {
          Readable: typeof NodeReadable;
        };
        if (Readable.toWeb) {
          stream = Readable.toWeb(
            response.nodeStream,
          ) as ReadableStream<Uint8Array>;
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
      // Env-mode boot race: the realm-server writes its Traefik dynamic
      // route file in `registerService`, but Traefik picks the file up
      // via inotify a short moment later. A worker that begins indexing
      // immediately after the realm-server's `listening` callback fires
      // can hit Traefik's default "404 page not found" before its own
      // route is live. With the current handler logging and returning
      // {} on that response, the from-scratch index finishes with zero
      // files and the realm stays mounted but unindexed for the rest
      // of the process's life. Distinguish the intermediary 404 from a
      // genuine realm-server 404 by checking for the `X-Boxel-Realm-Url`
      // header (every realm-server response carries it; Traefik's
      // default response doesn't). Retry with backoff while the header
      // is absent, so the eventual route-live state resolves naturally
      // and the index actually walks the realm.
      const MAX_ATTEMPTS = 10;
      const BACKOFF_MS = 200;
      let response: Response | undefined;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        response = await _fetch(`${realmURL}_mtimes`, {
          headers: {
            Accept: SupportedMimeType.Mtimes,
          },
        });
        if (response.ok) break;
        let fromRealmServer = response.headers.has('X-Boxel-Realm-Url');
        if (fromRealmServer || attempt === MAX_ATTEMPTS) break;
        console.warn(
          `mtimes for ${realmURL}_mtimes got ${response.status} from intermediary (no X-Boxel-Realm-Url header), retrying (attempt ${attempt}/${MAX_ATTEMPTS}) after ${attempt * BACKOFF_MS}ms`,
        );
        // Cancel the body before backing off — undici holds the
        // underlying connection in a reserved state until the body is
        // consumed or cancelled, and a 10-attempt loop on each indexed
        // realm at boot would otherwise pin sockets across the backoff
        // window for no benefit (the body is Traefik's "404 page not
        // found" which we never use).
        await response.body?.cancel().catch(() => {});
        await new Promise((resolve) =>
          setTimeout(resolve, attempt * BACKOFF_MS),
        );
      }
      if (!response!.ok) {
        let responseText = '';
        try {
          responseText = await response!.text();
        } catch {
          responseText = '';
        }
        let details = responseText ? `: ${responseText}` : '';
        console.warn(
          `mtimes request failed for ${realmURL}_mtimes (${response!.status} ${response!.statusText})${details}`,
        );
        return {};
      }
      let {
        data: {
          attributes: { mtimes },
        },
      } = (await response!.json()) as {
        data: { attributes: { mtimes: { [url: string]: number } } };
      };
      return mtimes;
    },
  };
}
