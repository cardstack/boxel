// Isomorphic UUID — matches IndexRunner's batch-id minting.
import { v4 as uuidv4 } from '@lukeed/uuid';
import { heartbeatJob } from '../queue.ts';

import {
  cardSourceForVisit,
  delay,
  flattenPrerenderHtmlVisitMeta,
  hasCardExtension,
  isBrowserTestEnv,
  isCardResource,
  jobIdentity,
  logger,
  addExplicitParens,
  every,
  param,
  query,
  separatedByCommas,
  modulesConsumedInMeta,
  RealmPaths,
  renderScopeFor,
  unixTime,
  type Batch,
  type BatchDoneResult,
  type DeclaredScreenshotError,
  type DeclaredScreenshotVisitArgs,
  type DeclaredScreenshotVisitResult,
  type DefinitionLookup,
  type Diagnostics,
  type Expression,
  type IndexWriter,
  type JobInfo,
  type LooseCardResource,
  type Prerenderer,
  type PrerenderedHtmlChange,
  type PriorScreenshotState,
  type Reader,
  type RenderRouteOptions,
  type RenderVisitResponse,
  type Stats,
} from '../index.ts';
import { putMedia, type MediaCacheAdapter } from '../media-cache.ts';
import {
  screenshotLedgerSourceURL,
  type ScreenshotManifest,
  type ScreenshotManifestEntry,
} from '../capture-spec.ts';
import type { DBAdapter } from '../db.ts';
import type { IndexingProgressEvent } from '../worker.ts';
import type { VirtualNetwork } from '../virtual-network.ts';
import {
  CardError,
  coerceErrorMessage,
  isCardError,
  serializableError,
} from '../error.ts';
import { resolveFileDefCodeRef } from '../file-def-code-ref.ts';
import { canonicalURL } from './dependency-url.ts';
import type { SpawningIndexPass } from '../jobs/prerender-html.ts';

// Ceiling on holding a prerender-html job's visits for its spawning passes'
// commits. Incremental commits land in well under a second of the enqueue; a
// from-scratch pass can hold this for its whole remaining runtime, so the
// ceiling sits at the same scale as the passes themselves.
const SPAWNING_PASS_WAIT_MS = 10 * 60_000;
import { uniqueDeps } from './dependency-collections.ts';
import {
  preWarmModulesTable,
  resolveModuleCacheContext,
} from './prewarm-modules.ts';

export interface PrerenderHtmlPassArgs {
  realmURL: URL;
  // The invalidation set the spawning index pass computed, tagged per URL:
  // dependents/re-renders as 'update', genuine deletions as 'delete'. The
  // fan-out is never recomputed here.
  changes: PrerenderedHtmlChange[];
  // The index passes that computed the invalidation set. The visits wait
  // until each has committed (a `realm_index_commits` row carries its pass id)
  // or its job has stopped running without committing it. Empty for a job
  // spawned from committed state.
  spawningIndexPasses: SpawningIndexPass[];
  // Read only while `spawningIndexPasses` is empty (see
  // `PrerenderHtmlArgs.generation`): the visits wait for the realm's
  // `current_generation` to reach it.
  generation: number;
  // The queue job that spawned this one. Both halves of an index pass present
  // a prerender tab with the same render scope, so a tab serving them does
  // not discard what it loaded when they alternate. A job with no
  // `spawningIndexPasses` also bounds its `generation` wait by this job's
  // liveness. Null for a job enqueued without a spawning job — its render
  // scope keys off this job's own id.
  spawningJobId: number | null;
  // The realm's loader epoch the spawning pass renders under. Threaded on
  // every visit so each prerender tab this pass touches resets its loader
  // exactly once when the realm's module surface changed.
  loaderEpoch: string;
  // True when a from-scratch index pass spawned this job: run the realm-wide
  // module pre-warm sweep before the format renders begin. False on
  // incremental spawns — the sweep is O(realm module count).
  preWarm: boolean;
  indexWriter: IndexWriter;
  definitionLookup: DefinitionLookup;
  virtualNetwork: VirtualNetwork;
  reader: Reader;
  // Authed fetch, used only to resolve the realm's module-cache scope for
  // pre-warm (public vs private + owner user id).
  fetch: typeof globalThis.fetch;
  // The realm owner the pre-warm's sub-`prerenderModule` renders as, and the
  // user id a private realm's cache is keyed on.
  realmOwnerUserId: string;
  prerenderer: Prerenderer;
  auth: string;
  jobInfo: JobInfo;
  jobPriority?: number;
  onProgress?: (event: IndexingProgressEvent) => void;
  // Declared-screenshot persistence. Both must be present for the pass to
  // request captures; a worker without a MediaCache configured (or a caller
  // without a direct DB handle) renders HTML exactly as before and writes
  // null manifests.
  dbAdapter?: DBAdapter;
  mediaCacheAdapter?: MediaCacheAdapter;
}

export interface PrerenderHtmlPassResult {
  invalidations: string[];
  // The realm's committed generation when the visits were released: every row
  // this pass wrote is stamped at or below it.
  generation: number;
  stats: Stats;
  // How long the visits waited for the spawning passes to commit, present
  // when the pass had a database to wait on.
  spawnGateMs?: number;
  // The pre-warm sweep's wall-clock, present only when it ran (a from-scratch-
  // spawned pass outside the browser). Surfaces on the job result so
  // dashboards attribute the sweep to the job that pays it.
  preWarmMs?: number;
  // The swap's wall-clock, its transaction's attempt counts, and the
  // post-commit cleanup of the pending tables (see `BatchDoneResult`),
  // present once the pass reached its swap.
  swapMs?: number;
  swapAttempts?: number;
  swapRetryMs?: number;
  pendingCleanupMs?: number;
  janitorRowsCleared?: number;
  janitorJobsCleared?: number;
}

// The `prerender_html` job's visit loop — the HTML channel's analog of the
// incremental index loop in `IndexRunner`. Waits for the spawning index
// passes to commit, stamps each row with its URL's live index generation (see
// `Batch.adoptIndexGenerations`), tombstones the whole invalidation set, then
// visits each 'update' URL with a standalone
// 'prerender-html' visit that renders from card+source (it never reads
// `boxel_index`), writing HTML or render-error rows into
// `prerendered_html_pending`; 'delete' URLs are never visited so their
// tombstones survive. A visit that fails without producing a response
// document at all (its prerender request aborting/timing out, a reader
// error) lands error rows too, via the same per-URL isolation the index
// loop applies (`handleVisitFailure`) — one URL's failure never discards
// the rest of the batch. `batch.done()` swaps the set into production under
// the monotonic generation guard.
export async function runPrerenderHtmlPass({
  realmURL,
  changes,
  spawningIndexPasses,
  generation,
  spawningJobId,
  loaderEpoch,
  preWarm,
  indexWriter,
  definitionLookup,
  virtualNetwork,
  reader,
  fetch,
  realmOwnerUserId,
  prerenderer,
  auth,
  jobInfo,
  jobPriority,
  onProgress,
  dbAdapter,
  mediaCacheAdapter,
}: PrerenderHtmlPassArgs): Promise<PrerenderHtmlPassResult> {
  let log = logger('prerender-html-runner');
  let perfLog = logger('index-perf');
  let start = Date.now();
  // realm + spawning index jobs ride on every log line so the render channel
  // can be correlated back to the index passes that spawned it.
  let jobTag = `${jobIdentity(jobInfo)} [realm: ${realmURL.href}] [spawning index jobs: ${[...new Set(spawningIndexPasses.map((pass) => pass.jobId))].join(', ') || 'none'}]`;
  let batchId = `${jobInfo.jobId}-${uuidv4().slice(0, 8)}`;
  let realmPaths = new RealmPaths(realmURL, virtualNetwork);
  let stats: Stats = {
    instancesIndexed: 0,
    filesIndexed: 0,
    instanceErrors: 0,
    fileErrors: 0,
    totalIndexEntries: 0,
  };

  log.debug(
    `${jobTag} starting prerender-html pass for ${changes.length} changes`,
  );

  // Delete-sticky dedupe, mirroring the incremental index loop: coalesced
  // publishes are already merged this way, but a single publish may still
  // carry duplicates.
  let operations = new Map<string, 'update' | 'delete'>();
  for (let { url, operation } of changes) {
    if (operation === 'delete') {
      operations.set(url, 'delete');
    } else if (!operations.has(url)) {
      operations.set(url, 'update');
    }
  }
  let totalFiles = operations.size;

  let batch = await indexWriter.createBatch(realmURL, virtualNetwork, jobInfo, {
    prerenderHtmlOnly: true,
  });

  // The job's URL set arrives fully computed in its args, so the progress row
  // opens with the render denominator rather than the index runner's zero. A
  // from-scratch-spawned job then grows this total during pre-warm below (the
  // sweep's module count isn't known until its dep analysis runs), so the
  // `file-visited` events carry the combined total — the event sink adopts the
  // latest `totalFiles` it sees. The jobType matches the queue's
  // `jobs.job_type` value so both spell the job the same way.
  onProgress?.({
    type: 'indexing-started',
    realmURL: realmURL.href,
    jobId: jobInfo.jobId,
    reservationId: jobInfo.reservationId,
    jobType: 'prerender_html',
    totalFiles,
    files: [],
  });

  let filesCompleted = 0;

  // Pre-warm the module definition cache before the format renders fire. The
  // realm-wide `.gts` / `.gjs` sweep is the layer that matters here: it primes
  // the sibling card modules referenced by *string* in query-backed field
  // renders (`<Search @query={{filter: {type: {module: '.../author.gts', name: 'Author'}}}}>`),
  // so a mid-render `lookupDefinition` hits a populated row instead of spawning
  // a same-affinity sub-`prerenderModule` that would stall the tab pool.
  //
  // Runs only when a from-scratch pass spawned this job (`preWarm`) — the sweep
  // is O(realm module count). Skipped in the browser: host tests run a Realm
  // inside a Chrome tab with no separate prerender server and no tab pool, and
  // populating the definition cache there bakes in keys the host's
  // card-reference-prefix reader can't match. The realm-wide list is re-derived
  // from `reader.mtimes()` rather than threaded through args — it mirrors the
  // index job's own source of truth and keeps the job payload from carrying an
  // O(realm) module list through every coalesce merge. Pre-warmed modules and
  // the files rendered below share one `totalFiles`, so the dashboard bar spans
  // both phases. Best-effort: a failure is warned and the format renders
  // populate the cache on demand. A retried job re-sweeps the whole realm (the
  // visit loop's resume-skip has no pre-warm analog), which is cheap — the
  // second attempt's populate calls hit the cache as O(1) reads, no re-renders.
  let preWarmMs: number | undefined;
  let swapMs: number | undefined;
  let swapCommit: Omit<BatchDoneResult, 'totalIndexEntries'> | undefined;
  if (preWarm && !isBrowserTestEnv()) {
    let preWarmStart = Date.now();
    try {
      let filesystemMtimes = await reader.mtimes();
      let allRealmCardModules =
        Object.keys(filesystemMtimes).filter(hasCardExtension);
      // Info, not debug: the sweep can hold this worker for minutes on a
      // module-heavy realm, and with few workers everything queued behind it
      // waits that long. CI logs need the sweep's span attributable without a
      // log-level override.
      log.info(
        `${jobTag} module pre-warm sweep starting (${allRealmCardModules.length} realm card modules)`,
      );
      let updateURLs = [...operations]
        .filter(([, operation]) => operation === 'update')
        .map(([url]) => new URL(url));
      let preWarmedCount = await preWarmModulesTable({
        realmURL,
        invalidations: updateURLs,
        allRealmCardModules,
        definitionLookup,
        virtualNetwork,
        reader,
        getDependencyRows: (urls) => batch.getDependencyRows(urls),
        getModuleCacheContext: () =>
          resolveModuleCacheContext({ fetch, realmURL, realmOwnerUserId }),
        prerenderUserId: realmOwnerUserId,
        jobPriority: jobPriority ?? 0,
        jobInfo,
        log,
        perfLog,
        onModuleWarmed: ({ moduleUrl, warmedCount, totalToWarm }) => {
          filesCompleted = warmedCount;
          totalFiles = totalToWarm + operations.size;
          onProgress?.({
            type: 'file-visited',
            realmURL: realmURL.href,
            jobId: jobInfo.jobId,
            reservationId: jobInfo.reservationId,
            url: moduleUrl,
            filesCompleted,
            totalFiles,
          });
        },
      });
      totalFiles = preWarmedCount + operations.size;
      log.info(
        `${jobTag} module pre-warm sweep completed (${preWarmedCount} modules warmed) in ${Date.now() - preWarmStart} ms`,
      );
    } catch (e) {
      log.warn(
        `${jobTag} module pre-warm failed; the format renders will populate the definition cache on demand: ${(e as Error)?.message}`,
      );
    }
    preWarmMs = Date.now() - preWarmStart;
  }

  // Hold the visits until the spawning passes have committed. A visit's own
  // card + source come from the reader, but anything its renders load lazily
  // — a linked card only a capture-only screenshot component reads is the
  // canonical case — is served from `boxel_index`, which a spawning pass swaps
  // only at its commit. This job is enqueued as soon as the invalidation set
  // is known (deliberately, so queue latency and the module pre-warm above
  // overlap the tail of the index pass), so ungated visits can read pre-edit
  // documents and persist superseded linked data.
  let spawnGateMs: number | undefined;
  if (dbAdapter) {
    let gate = await awaitSpawningPasses({
      dbAdapter,
      realmURL,
      spawningIndexPasses,
      generation,
      spawningJobId,
      jobInfo,
    });
    spawnGateMs = gate.waitMs;
    if (gate.uncommitted.length === 0) {
      if (gate.waitMs > 1000) {
        perfLog.debug(
          `${jobTag} spawning-pass gate held the visits ${gate.waitMs} ms`,
        );
      }
    } else {
      log.warn(
        `${jobTag} rendering against the committed index: ${gate.uncommitted.join('; ')}`,
      );
    }
  }

  // With the spawning passes committed, every row this pass writes takes its
  // URL's live index generation, so a peer pass that committed in between
  // cannot leave the stamps and the index rows they describe disagreeing.
  // The tombstones seeded next are rows too, so they follow the adoption.
  let renderGeneration = await batch.adoptIndexGenerations([
    ...operations.keys(),
  ]);
  jobTag = `${jobTag} [generation: ${renderGeneration}]`;
  await batch.seedPrerenderedHtmlInvalidations(
    [...operations].map(([url, operation]) => ({ url, operation })),
  );

  // One batched read of every rendered URL's content hash/size so the
  // per-visit getContentMeta lookups are served from memory rather than a DB
  // round-trip each. Deletes aren't visited, so they're excluded; URLs outside
  // this realm are skipped the same way the visit skips them.
  let prefetchPaths: string[] = [];
  for (let [href, operation] of operations) {
    if (operation === 'delete') {
      continue;
    }
    try {
      prefetchPaths.push(realmPaths.local(new URL(href)));
    } catch (_e) {
      // different realm — not visited
    }
  }
  await batch.prefetchFileMeta(prefetchPaths);

  let resumedRows = batch.resumedRows;
  let resumedSkipped = 0;
  let tombstoned = 0;
  try {
    for (let [href, operation] of operations) {
      if (operation === 'delete') {
        // Deletion is the explicit threaded operation: never visited, the
        // up-front tombstone survives to the swap.
        tombstoned++;
      } else if (resumedRows.has(href)) {
        // A previous attempt of this job already rendered this URL.
        // `args.changes` is the deterministic seed, so the resumed row is
        // authoritative for this job.
        resumedSkipped++;
      } else {
        try {
          await visitForPrerenderedHtml({
            url: new URL(href),
            realmURL,
            spawningJobId,
            realmPaths,
            reader,
            batch,
            prerenderer,
            virtualNetwork,
            auth,
            batchId,
            jobInfo,
            jobPriority,
            loaderEpoch,
            stats,
            log,
            dbAdapter,
            mediaCacheAdapter,
          });
        } catch (err) {
          await handleVisitFailure({
            url: new URL(href),
            err,
            batch,
            reader,
            jobInfo,
            stats,
            log,
          });
        }
      }
      filesCompleted++;
      onProgress?.({
        type: 'file-visited',
        realmURL: realmURL.href,
        jobId: jobInfo.jobId,
        reservationId: jobInfo.reservationId,
        url: href,
        filesCompleted,
        totalFiles,
      });
    }
    if (resumedSkipped > 0) {
      perfLog.debug(
        `${jobTag} skipped ${resumedSkipped} URLs already rendered by prior attempt`,
      );
    }
    let swapStart = Date.now();
    let { totalIndexEntries, ...commit } = await batch.done();
    swapMs = Date.now() - swapStart;
    swapCommit = commit;
    stats.totalIndexEntries = totalIndexEntries;
    perfLog.debug(`${jobTag} completed prerendered-html swap in ${swapMs} ms`);
  } finally {
    onProgress?.({
      type: 'indexing-finished',
      realmURL: realmURL.href,
      jobId: jobInfo.jobId,
      stats,
    });
    // Release the batch's ownership of this realm's affinity on the
    // prerender server. Best-effort, mirroring IndexRunner.
    try {
      await prerenderer.releaseBatch?.({
        batchId,
        affinityType: 'realm',
        affinityValue: realmURL.href,
      });
    } catch (e) {
      log.warn(
        `${jobTag} failed to release prerender batch ${batchId}: ${(e as Error)?.message}`,
      );
    }
  }

  log.debug(
    `${jobTag} completed prerender-html pass (rendered ${stats.instancesIndexed} instances / ${stats.filesIndexed} files, ${
      stats.instanceErrors + stats.fileErrors
    } errors, ${tombstoned} tombstoned) in ${Date.now() - start} ms`,
  );
  return {
    invalidations: batch.invalidations,
    generation: renderGeneration,
    stats,
    ...(spawnGateMs !== undefined ? { spawnGateMs } : {}),
    ...(preWarmMs !== undefined ? { preWarmMs } : {}),
    ...(swapMs !== undefined ? { swapMs } : {}),
    ...(swapCommit ?? {}),
  };
}

// Waits until the index passes that spawned a prerender-html job have
// committed, and returns how long that took plus, for each spawner it stopped
// waiting on without seeing it commit, why.
//
// A spawning pass allocates its generation only when it commits, so the wait
// is keyed on its pass id and answered by the `realm_index_commits` ledger: a
// row carrying that pass id means the pass's commit is durable. Another pass's
// commit advances `current_generation` just the same, which is why the
// watermark cannot stand in for the ledger here — and so does another attempt
// of the same job, which is why the job id cannot either.
//
// The wait's true bound is each spawning job's liveness, not wall clock: a
// pass whose job reached a terminal status without the pass committing (its
// commit failed, or the realm was wiped out from under it — deletion and
// unpublish do this legitimately) never will, and production then still serves exactly
// what these renders would read, so proceeding renders a consistent state.
// Holding a worker on wall clock instead starves every job queued behind this
// one for the full ceiling in exactly those flows. `SPAWNING_PASS_WAIT_MS` is
// a backstop against pathological job-row states only.
//
// A job with no spawning index passes was spawned from committed state
// (reconcile), or by a worker predating the ledger wait; either way it
// carries a generation, and it waits for `current_generation` to reach that,
// bounded by `spawningJobId`'s liveness. A reconcile's generation is already
// committed, so its first probe passes.
async function awaitSpawningPasses({
  dbAdapter,
  realmURL,
  spawningIndexPasses,
  generation,
  spawningJobId,
  jobInfo,
}: {
  dbAdapter: DBAdapter;
  realmURL: URL;
  spawningIndexPasses: SpawningIndexPass[];
  generation: number;
  spawningJobId: number | null;
  jobInfo: JobInfo;
}): Promise<{ waitMs: number; uncommitted: string[] }> {
  let start = Date.now();
  if (spawningIndexPasses.length > 0) {
    let pending = new Map(
      spawningIndexPasses.map((pass) => [pass.passId, pass]),
    );
    let uncommitted: string[] = [];
    while (pending.size > 0) {
      for (let passId of await committedPasses(
        dbAdapter,
        realmURL,
        pending.keys(),
      )) {
        pending.delete(passId);
      }
      if (pending.size === 0) {
        break;
      }
      let running = await runningJobs(
        dbAdapter,
        new Set([...pending.values()].map((pass) => pass.jobId)),
      );
      let stopped = [...pending.values()].filter(
        (pass) => !running.has(pass.jobId),
      );
      if (stopped.length > 0) {
        // A spawner commits its batch and only then resolves, so a terminal
        // status read here may postdate a commit the ledger probe above
        // predates — give the ledger one last read for those.
        let committedLate = await committedPasses(
          dbAdapter,
          realmURL,
          stopped.map((pass) => pass.passId),
        );
        for (let pass of stopped) {
          pending.delete(pass.passId);
          if (!committedLate.has(pass.passId)) {
            uncommitted.push(
              `spawning index job ${pass.jobId} stopped running without committing pass ${pass.passId}`,
            );
          }
        }
        continue;
      }
      if (Date.now() - start >= SPAWNING_PASS_WAIT_MS) {
        uncommitted.push(
          ...[...pending.values()].map(
            (pass) =>
              `spawning index job ${pass.jobId} had not committed pass ${pass.passId} after ${SPAWNING_PASS_WAIT_MS} ms`,
          ),
        );
        break;
      }
      await waitAndHeartbeat(jobInfo);
    }
    return { waitMs: Date.now() - start, uncommitted };
  }
  let committed = false;
  let stopped = false;
  while (Date.now() - start < SPAWNING_PASS_WAIT_MS) {
    if ((await committedGeneration(dbAdapter, realmURL)) >= generation) {
      committed = true;
      break;
    }
    if (spawningJobId == null) {
      stopped = true;
      break;
    }
    if (!(await runningJobs(dbAdapter, new Set([spawningJobId]))).size) {
      // The same last read as above, against the watermark.
      committed =
        (await committedGeneration(dbAdapter, realmURL)) >= generation;
      stopped = true;
      break;
    }
    await waitAndHeartbeat(jobInfo);
  }
  return {
    waitMs: Date.now() - start,
    uncommitted: committed
      ? []
      : [
          `generation ${generation} is not committed and ${
            spawningJobId == null
              ? 'no spawning job is recorded'
              : stopped
                ? `spawning job ${spawningJobId} is not running`
                : `spawning job ${spawningJobId} had not committed it after ${SPAWNING_PASS_WAIT_MS} ms`
          }`,
        ],
  };
}

// Waiting on the spawning passes is progress, and on a realm whose index pass
// runs long this wait can reach its own ceiling — which is the same ten
// minutes as the deadline an incremental-spawned pass is given. A job that
// never rendered a file would otherwise be cut off here, in the exact case a
// progress-bounded deadline exists to protect. Counting a poll as proof of
// life costs the watchdog nothing: the wait is bounded independently by
// `SPAWNING_PASS_WAIT_MS`.
async function waitAndHeartbeat(jobInfo: JobInfo): Promise<void> {
  heartbeatJob(jobInfo.reservationId);
  await delay(250);
}

// Which of these index passes have a commit of this realm on the ledger.
async function committedPasses(
  dbAdapter: DBAdapter,
  realmURL: URL,
  passIds: Iterable<string>,
): Promise<Set<string>> {
  let rows = (await query(dbAdapter, [
    'SELECT pass_id FROM realm_index_commits WHERE',
    ...every([
      ['realm_url =', param(realmURL.href)],
      [
        'pass_id IN',
        ...addExplicitParens(
          separatedByCommas([...passIds].map((id) => [param(id)])),
        ),
      ],
    ]),
  ] as Expression)) as { pass_id: string }[];
  return new Set(rows.map((row) => row.pass_id));
}

// Which of these jobs are still queued or running.
async function runningJobs(
  dbAdapter: DBAdapter,
  jobIds: Set<number>,
): Promise<Set<number>> {
  let rows = (await query(dbAdapter, [
    'SELECT id FROM jobs WHERE',
    ...every([
      [
        'id IN',
        ...addExplicitParens(
          separatedByCommas([...jobIds].map((id) => [param(id)])),
        ),
      ],
      [`status = 'unfulfilled'`],
    ]),
  ] as Expression)) as { id: number | string }[];
  return new Set(rows.map((row) => Number(row.id)));
}

async function committedGeneration(
  dbAdapter: DBAdapter,
  realmURL: URL,
): Promise<number> {
  let [row] = (await query(dbAdapter, [
    'SELECT current_generation FROM realm_generations WHERE realm_url =',
    param(realmURL.href),
  ])) as { current_generation: number | string }[];
  return row == null ? -1 : Number(row.current_generation);
}

// Per-slot wall-clock of the visit's capture attempts, keyed by slot name —
// assembled from the engine result's entries and errors (a failed attempt's
// time was spent all the same). Carry-forwards and never-attempted slots
// (roster failure, capture-cap overflow) record nothing. Undefined when no
// slot recorded a time, so callers can spread it conditionally.
export function declaredScreenshotTimingsMs(
  result: DeclaredScreenshotVisitResult | undefined,
): Record<string, number> | undefined {
  if (!result) {
    return undefined;
  }
  let timings: Record<string, number> = {};
  for (let entry of result.entries) {
    if (entry.captureMs !== undefined) {
      timings[entry.name] = entry.captureMs;
    }
  }
  for (let error of result.errors ?? []) {
    if (error.captureMs !== undefined) {
      timings[error.name] = error.captureMs;
    }
  }
  return Object.keys(timings).length > 0 ? timings : undefined;
}

// Persist the visit's declared-screenshot captures into the MediaCache and
// assemble the row's manifest. Fresh captures putMedia under the 'declared'
// lane; carry-forwards copy the prior manifest entry (their ledger row from
// the earlier generation stays live — a 'declared' entry ages out only when
// superseded, and no supersession happens without a re-capture). A persist
// failure is a per-slot error, never a visit failure — the manifest omits
// the name and diagnostics.screenshotErrors records why, mirroring
// brokenLinks.
//
// Every returned error carries `consecutiveFailures`: the prior row's
// recorded run for the same slot name, extended by one — or a run of one
// where the prior row had no failure under that name (a roster-level
// failure records under '*', so it starts its own run rather than
// extending per-name ones). Because a name absent from this render's
// errors has its run dropped, per-name runs alone cannot bound retries
// when the failing name shifts between renders — so any failure also
// extends the row-level `captureFailureRenders` counter (the prior row's
// count plus one, regardless of which names failed), and the reconcile
// sweep's bounded retry lane caps on that.
export async function persistDeclaredScreenshots({
  result,
  priorManifest,
  priorScreenshotErrors,
  priorCaptureFailureRenders,
  dbAdapter,
  mediaCacheAdapter,
  realmURL,
  sourceURL,
  sourceGeneration,
  contentHash,
  jobInfo,
  log,
}: {
  result: DeclaredScreenshotVisitResult | undefined;
  priorManifest: ScreenshotManifest | null;
  priorScreenshotErrors?: DeclaredScreenshotError[] | null;
  priorCaptureFailureRenders?: number | null;
  dbAdapter: DBAdapter;
  mediaCacheAdapter: MediaCacheAdapter;
  realmURL: URL;
  sourceURL: string;
  sourceGeneration: number;
  contentHash: string | undefined;
  jobInfo: JobInfo;
  log: ReturnType<typeof logger>;
}): Promise<{
  manifest: ScreenshotManifest | null;
  errors: DeclaredScreenshotError[];
  // Present exactly when `errors` is non-empty: the row's consecutive
  // capture-failure render count, for `screenshotCaptureFailureRenders`.
  captureFailureRenders?: number;
}> {
  // The prerenderer didn't run the capture step (an implementation without
  // it, e.g. the in-browser twin): no manifest, not an error.
  if (!result) {
    return { manifest: null, errors: [] };
  }
  let manifest: ScreenshotManifest = {};
  let errors: DeclaredScreenshotError[] = [...(result.errors ?? [])];
  for (let entry of result.entries) {
    if (entry.carriedForward) {
      let prior = priorManifest?.[entry.name];
      if (prior) {
        manifest[entry.name] = prior;
      } else {
        errors.push({
          name: entry.name,
          message: `capture engine carried "${entry.name}" forward but the prior manifest has no such entry`,
        });
      }
      continue;
    }
    if (!entry.base64) {
      errors.push({
        name: entry.name,
        message: `capture engine returned no bytes for "${entry.name}"`,
      });
      continue;
    }
    try {
      let binaryString = atob(entry.base64);
      let bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      // A pdf capture is a paged document, not a raster tile: it persists with
      // null pixel dimensions (the ledger and both adapters are
      // format-agnostic) and carries the paginated document's page count and
      // byte size on the manifest instead of width/height/deviceScaleFactor.
      let isPdf = entry.contentType === 'application/pdf';
      let { objectKey } = await putMedia(dbAdapter, mediaCacheAdapter, {
        bytes,
        contentType: entry.contentType,
        realmURL: realmURL.href,
        sourceURL,
        captureSpecHash: entry.specHash,
        sourceGeneration,
        sourceContentHash:
          entry.keyBy === 'file-content' ? (contentHash ?? null) : null,
        lane: 'declared',
        width: isPdf ? null : entry.width,
        height: isPdf ? null : entry.height,
      });
      let manifestEntry: ScreenshotManifestEntry = {
        specHash: entry.specHash,
        objectKey,
        contentType: entry.contentType,
        ...(isPdf
          ? {
              ...(entry.pageCount !== undefined
                ? { pageCount: entry.pageCount }
                : {}),
              byteSize: bytes.byteLength,
            }
          : {
              width: entry.width,
              height: entry.height,
              deviceScaleFactor: entry.deviceScaleFactor,
            }),
        ...(entry.useAsThumbnail ? { useAsThumbnail: true as const } : {}),
        ...(entry.keyBy === 'file-content' && contentHash
          ? { sourceContentHash: contentHash }
          : {}),
      };
      manifest[entry.name] = manifestEntry;
    } catch (e: any) {
      log.warn(
        `${jobIdentity(jobInfo)} failed to persist declared screenshot "${entry.name}" of ${sourceURL}: ${e?.message ?? e}`,
      );
      errors.push({
        name: entry.name,
        message: `failed to persist capture: ${e?.message ?? String(e)}`,
      });
    }
  }
  let captureFailureRenders: number | undefined;
  if (errors.length > 0) {
    let priorRunByName = new Map(
      (priorScreenshotErrors ?? []).map((error) => [
        error.name,
        // A legacy row recorded before the bookkeeping counts as a run of
        // one — same default the reconcile sweep's scan applies.
        error.consecutiveFailures ?? 1,
      ]),
    );
    errors = errors.map((error) => ({
      ...error,
      consecutiveFailures: (priorRunByName.get(error.name) ?? 0) + 1,
    }));
    captureFailureRenders =
      (priorCaptureFailureRenders ??
        // A prior row with recorded failures but no counter is a legacy
        // row — one failing render, same default the sweep's scan applies.
        (priorScreenshotErrors?.length ? 1 : 0)) + 1;
  }
  return {
    manifest: Object.keys(manifest).length > 0 ? manifest : null,
    errors,
    ...(captureFailureRenders !== undefined ? { captureFailureRenders } : {}),
  };
}

async function visitForPrerenderedHtml({
  url,
  realmURL,
  spawningJobId,
  realmPaths,
  reader,
  batch,
  prerenderer,
  virtualNetwork,
  auth,
  batchId,
  jobInfo,
  jobPriority,
  loaderEpoch,
  stats,
  log,
  dbAdapter,
  mediaCacheAdapter,
}: {
  url: URL;
  realmURL: URL;
  spawningJobId: number | null;
  realmPaths: RealmPaths;
  reader: Reader;
  batch: Batch;
  prerenderer: Prerenderer;
  virtualNetwork: VirtualNetwork;
  auth: string;
  batchId: string;
  jobInfo: JobInfo;
  jobPriority?: number;
  loaderEpoch: string;
  stats: Stats;
  log: ReturnType<typeof logger>;
  dbAdapter?: DBAdapter;
  mediaCacheAdapter?: MediaCacheAdapter;
}): Promise<void> {
  let localPath: string;
  try {
    localPath = realmPaths.local(url);
  } catch (_e) {
    log.debug(
      `${jobIdentity(jobInfo)} prerender-html visit of ${url.href} skipped (different realm than ${realmURL.href})`,
    );
    return;
  }

  let fileRef = await reader.readFile(url);
  if (!fileRef) {
    fileRef = await reader.readFile(new URL(encodeURI(localPath), url));
  }
  if (!fileRef) {
    // Unreadable file — the same outcome as the index visit's
    // missing-file handling: write nothing, so the up-front tombstone
    // survives to the swap and the two channels agree. This is how a
    // deletion that arrives under an alias form (e.g. a card delete names
    // the extensionless URL while the fan-out carries the `.json` form as
    // an update) lands consistently on both channels.
    log.info(
      `${jobIdentity(jobInfo)} tried to prerender file ${url.href}, but it no longer exists`,
    );
    return;
  }

  let parsedCardResource: LooseCardResource | undefined;
  if (url.href.endsWith('.json')) {
    try {
      let { data } = JSON.parse(fileRef.content);
      if (data && isCardResource(data)) {
        parsedCardResource = data as LooseCardResource;
      }
    } catch (_e) {
      // not card JSON — the file rendering still runs
    }
  }

  let fileURL = url.href;
  let fileDefCodeRef = resolveFileDefCodeRef(new URL(fileURL), virtualNetwork);

  // Floored once and used by both consumers below, so the modified time the
  // render stamps onto the card's document and the one the file's HTML bakes
  // are the same number even for a file whose adapter reports no mtime.
  let fileLastModified = fileRef.lastModified ?? unixTime(Date.now());

  let cardSource = cardSourceForVisit({
    source: fileRef.content,
    realmURL: realmURL.href,
    lastModified: fileLastModified,
    isCardInstance: Boolean(parsedCardResource),
  });

  // Hand through the write-time content hash + size so the extract pass can
  // skip buffering the file (same optimization as the index visit; only
  // forwarded when both are present).
  let { contentHash, contentSize } = await batch.getContentMeta(localPath);
  // And the file's timestamps, the same values the index visit writes to its
  // row (visit-file.ts): the extract stamps them onto the resource this
  // visit's fileRender pass hydrates its FileDef from, so the HTML it bakes
  // shows the same modified time a live render of the row does. Served from
  // the prefetch above; the row already exists once the index visit has run.
  let fileCreatedAt = await batch.ensureFileCreatedAt(localPath);

  let renderOptions: RenderRouteOptions = {
    fileDefCodeRef,
    ...(parsedCardResource ? { cardRender: true } : {}),
    fileRender: true,
    // The standalone visit resolves the file's resource + types from source
    // via the extract pass — no chaining off a prior index visit, no
    // boxel_index read.
    fileExtract: true,
    loaderEpoch,
    ...(contentHash !== undefined && contentSize !== undefined
      ? { fileContentHash: contentHash, fileContentSize: contentSize }
      : {}),
    // Floored the way the index visit floors it (visit-file.ts), because the
    // row this visit runs after already holds that floor: leaving the option
    // off when the adapter reports no mtime would bake HTML with no modified
    // time against a row that has one, which is the disagreement between the
    // two channels this whole path exists to remove. The extract's
    // `last-modified` header fallback cannot cover it here — forwarding the
    // content hash and size above is what lets the extract skip its own fetch,
    // so no response header is ever read.
    //
    // The two floors are separate `Date.now()` reads and so not bit-identical,
    // but both shells render this at day granularity, and an indexing pass
    // does not straddle midnight often enough for the difference to reach a
    // reader. Sourcing it from the row would need a per-path accessor that
    // does not exist — `realm_file_meta` carries createdAt, contentHash and
    // contentSize, not lastModified.
    fileLastModified,
    fileCreatedAt,
  };

  // Declared-screenshot capture rides the visit only when this pass can
  // persist the bytes (both adapters present). One opt-in covers both of the
  // URL's renderings — the card pass captures only when the URL has a card
  // rendering at all, so no per-half gating is needed here. Each row's prior
  // state goes along keyed by row type: the manifest so file-content-keyed
  // slots can carry forward in-engine, the recorded failures to seed this
  // pass's consecutive-failure bookkeeping.
  let captureScreenshots = Boolean(dbAdapter && mediaCacheAdapter);
  let priorStates:
    | Partial<Record<'instance' | 'file', PriorScreenshotState>>
    | undefined;
  let screenshotVisitArgs: DeclaredScreenshotVisitArgs | undefined;
  if (captureScreenshots) {
    priorStates = await batch.priorScreenshotStates(url);
    let priorManifests: Partial<
      Record<'instance' | 'file', ScreenshotManifest>
    > = {};
    for (let kind of ['instance', 'file'] as const) {
      let manifest = priorStates[kind]?.manifest;
      if (manifest && Object.keys(manifest).length > 0) {
        priorManifests[kind] = manifest;
      }
    }
    screenshotVisitArgs = {
      ...(Object.keys(priorManifests).length > 0 ? { priorManifests } : {}),
      ...(contentHash !== undefined ? { contentHash } : {}),
    };
  }

  let response: RenderVisitResponse = await prerenderer.prerenderVisit({
    affinityType: 'realm',
    affinityValue: realmURL.href,
    realm: realmURL.href,
    url: fileURL,
    auth,
    batchId,
    // The job of the index pass that spawned this one, so both halves of that
    // pass present a tab with one scope. A job enqueued without a spawning
    // pass keys on its own — except when it has no real job either, where the
    // caller's `-1` placeholder would make one bucket shared by every such
    // pass; carry no scope there and let the page fall back to the job id,
    // which is narrower and so never unsound. Same rule as `visit-file.ts`.
    ...((spawningJobId ?? jobInfo.jobId) >= 0
      ? {
          renderScope: renderScopeFor(
            realmURL.href,
            spawningJobId ?? jobInfo.jobId,
          ),
        }
      : {}),
    visitType: 'prerender-html',
    renderOptions,
    // The bytes this visit already read, so the card's format renders build
    // their model from them rather than fetching the instance's source again.
    // This job runs separately from the index pass and so cannot share that
    // pass's read — but its own read, the one that answered "is this card JSON"
    // above, now feeds the render too, which is the pair that can collapse.
    ...(cardSource ? { cardSource } : {}),
    ...(jobPriority !== undefined ? { priority: jobPriority } : {}),
    ...(jobInfo ? { jobId: `${jobInfo.jobId}.${jobInfo.reservationId}` } : {}),
    ...(screenshotVisitArgs ? { screenshots: screenshotVisitArgs } : {}),
  });

  // The visit's render diagnostics (launch/wait timings, render elapsed,
  // per-format render timings, `prerenderHtmlRequestId`). One visit produces
  // both the instance and the file rendering of a URL, so the same blob
  // lands on both rows — mirroring how the fused pass stamps one merged
  // blob on both of a URL's `boxel_index` rows.
  let diagnostics = flattenPrerenderHtmlVisitMeta(response.meta);

  if (parsedCardResource) {
    let card = response.card;
    let cardError = card?.error ?? response.pageUnusableError;
    if (cardError || !card) {
      let error = cardError?.error ?? {
        message: `prerenderVisit returned no card result for a card resource`,
        status: 500,
        additionalErrors: null,
      };
      // Same dep enrichment the index channel's error path applies: the
      // error doc's deps must cover the modules the card consumes so fixing
      // one invalidates this row and clears the error.
      let metaModuleDeps = parsedCardResource.meta
        ? modulesConsumedInMeta(parsedCardResource.meta).map((m) =>
            canonicalURL(m, fileURL, virtualNetwork),
          )
        : undefined;
      await batch.updatePrerenderedHtmlEntry(url, {
        type: 'instance-error',
        error: {
          ...error,
          deps: uniqueDeps(error.deps, card?.deps ?? undefined, metaModuleDeps),
        },
        ...(diagnostics ? { diagnostics } : {}),
      });
      stats.instanceErrors++;
    } else {
      let screenshotOutcome =
        captureScreenshots && dbAdapter && mediaCacheAdapter
          ? await persistDeclaredScreenshots({
              result: card.screenshots,
              priorManifest: priorStates?.instance?.manifest ?? null,
              priorScreenshotErrors: priorStates?.instance?.screenshotErrors,
              priorCaptureFailureRenders:
                priorStates?.instance?.captureFailureRenders,
              dbAdapter,
              mediaCacheAdapter,
              realmURL,
              sourceURL: screenshotLedgerSourceURL(fileURL, 'instance'),
              // The generation the instance row is stamped with, which is its
              // live index row's — the one the `_screenshot/` serving gate
              // resolves a capture under.
              sourceGeneration: batch.htmlRowGeneration(fileURL, 'instance'),
              contentHash,
              jobInfo,
              log,
            })
          : undefined;
      let screenshotTimingsMs = declaredScreenshotTimingsMs(card.screenshots);
      let instanceDiagnostics: Diagnostics | undefined =
        (screenshotOutcome && screenshotOutcome.errors.length > 0) ||
        screenshotTimingsMs
          ? {
              ...(diagnostics ?? {}),
              ...(screenshotOutcome && screenshotOutcome.errors.length > 0
                ? {
                    screenshotErrors: screenshotOutcome.errors,
                    screenshotCaptureFailureRenders:
                      screenshotOutcome.captureFailureRenders,
                  }
                : {}),
              ...(screenshotTimingsMs ? { screenshotTimingsMs } : {}),
            }
          : diagnostics;
      await batch.updatePrerenderedHtmlEntry(url, {
        type: 'instance',
        isolatedHtml: card.isolatedHTML,
        headHtml: card.headHTML,
        atomHtml: card.atomHTML,
        embeddedHtml: card.embeddedHTML,
        fittedHtml: card.fittedHTML,
        markdown: card.markdown,
        // The render route's settle-time dependency snapshot — what the
        // format renders actually pulled in (scoped-CSS URLs included).
        deps: card.deps ?? [],
        ...(instanceDiagnostics ? { diagnostics: instanceDiagnostics } : {}),
        screenshots: screenshotOutcome?.manifest ?? null,
      });
      stats.instancesIndexed++;
    }
  }

  // Every URL has a file rendering (FileDef formats), mirroring the fused
  // visit.
  let fileRender = response.fileRender;
  let fileError = fileRender?.error ?? response.pageUnusableError;
  if (fileError || !fileRender) {
    let error = fileError?.error ?? {
      message: `prerenderVisit returned no file rendering`,
      status: 500,
      additionalErrors: null,
    };
    await batch.updatePrerenderedHtmlEntry(url, {
      type: 'file-error',
      error: {
        ...error,
        deps: uniqueDeps(error.deps, response.fileExtract?.deps),
      },
      ...(diagnostics ? { diagnostics } : {}),
    });
    stats.fileErrors++;
  } else {
    let fileScreenshotOutcome =
      captureScreenshots && dbAdapter && mediaCacheAdapter
        ? await persistDeclaredScreenshots({
            result: fileRender.screenshots,
            priorManifest: priorStates?.file?.manifest ?? null,
            priorScreenshotErrors: priorStates?.file?.screenshotErrors,
            priorCaptureFailureRenders:
              priorStates?.file?.captureFailureRenders,
            dbAdapter,
            mediaCacheAdapter,
            realmURL,
            sourceURL: screenshotLedgerSourceURL(fileURL, 'file'),
            sourceGeneration: batch.htmlRowGeneration(fileURL, 'file'),
            contentHash,
            jobInfo,
            log,
          })
        : undefined;
    let fileScreenshotTimingsMs = declaredScreenshotTimingsMs(
      fileRender.screenshots,
    );
    let fileDiagnostics: Diagnostics | undefined =
      (fileScreenshotOutcome && fileScreenshotOutcome.errors.length > 0) ||
      fileScreenshotTimingsMs
        ? {
            ...(diagnostics ?? {}),
            ...(fileScreenshotOutcome && fileScreenshotOutcome.errors.length > 0
              ? {
                  screenshotErrors: fileScreenshotOutcome.errors,
                  screenshotCaptureFailureRenders:
                    fileScreenshotOutcome.captureFailureRenders,
                }
              : {}),
            ...(fileScreenshotTimingsMs
              ? { screenshotTimingsMs: fileScreenshotTimingsMs }
              : {}),
          }
        : diagnostics;
    await batch.updatePrerenderedHtmlEntry(url, {
      type: 'file',
      isolatedHtml: fileRender.isolatedHTML,
      headHtml: fileRender.headHTML,
      atomHtml: fileRender.atomHTML,
      embeddedHtml: fileRender.embeddedHTML,
      fittedHtml: fileRender.fittedHTML,
      markdown: fileRender.markdown,
      deps: response.fileExtract?.deps ?? [],
      ...(fileDiagnostics ? { diagnostics: fileDiagnostics } : {}),
      screenshots: fileScreenshotOutcome?.manifest ?? null,
    });
    stats.filesIndexed++;
  }
}

// Per-URL failure isolation, mirroring the index visit loop's
// (`IndexRunner`'s) handling of the same class of failure. A
// transport-level failure of the visit — its prerender request timing out /
// aborting before a response document exists, or a reader/network error —
// never reaches the in-band error-entry construction in
// `visitForPrerenderedHtml`; the visit rejects instead. Left uncaught, one
// URL's failure propagates out of the visit loop, skips `batch.done()`, and
// discards every other rendered URL's rows for the whole job — and because
// nothing is persisted for the failed URL either, the reconcile sweep reads
// it as "never attempted" and re-enqueues the identical batch every tick.
// Persisting error rows contains the failure to this URL: they carry the
// batch's generation and the last-known-good HTML is preserved beneath the
// error like any other render failure's row.
//
// The error is marked `visitRequestFailure` because this failure describes
// the request, not the content — the render never returned a verdict, so a
// retry can legitimately succeed (e.g. an abort under temporary prerender
// congestion). The reconcile sweep gives such rows a bounded retry lane:
// re-rendered at most `PRERENDER_HTML_VISIT_FAILURE_RETRY_CAP` consecutive
// times, spaced by the sweep cadence, then terminal exactly like a
// deterministic render error. The bound is what protects the fleet — each
// retry of a genuinely pathological visit burns its realm's prerender
// affinity lane for the full request timeout, so retries must converge to
// "recorded error, move on" rather than repeat indefinitely.
async function handleVisitFailure({
  url,
  err,
  batch,
  reader,
  jobInfo,
  stats,
  log,
}: {
  url: URL;
  err: unknown;
  batch: Batch;
  reader: Reader;
  jobInfo: JobInfo;
  stats: Stats;
  log: ReturnType<typeof logger>;
}): Promise<void> {
  if (isCardError(err) && err.status === 404) {
    log.info(
      `${jobIdentity(jobInfo)} tried to prerender file ${url.href}, but it no longer exists`,
    );
    return;
  }
  let message = coerceErrorMessage(
    err,
    `Prerendering failed for ${url.href} with no error message (${jobIdentity(jobInfo)})`,
  );
  log.warn(
    `${jobIdentity(jobInfo)} failed to prerender ${url.href}, recording error rows: ${message}`,
  );
  let error = isCardError(err)
    ? serializableError(err)
    : serializableError(
        Object.assign(new CardError(message, { status: 500 }), {
          stack: (err as Error)?.stack,
        }),
      );
  error.message = message;
  error.visitRequestFailure = true;
  await batch.updatePrerenderedHtmlEntry(url, { type: 'file-error', error });
  stats.fileErrors++;
  // The up-front seeding tombstoned every type this URL previously had in
  // `prerendered_html` — for an existing card that's both `instance` and
  // `file`. Overwriting only the `file` tombstone above would let the swap
  // promote the untouched `instance` tombstone, silently removing a
  // previously-good card's HTML over a transient failure. The batch records
  // which live row types it tombstoned, so an existing card is protected
  // even when the file can't be read — which may be exactly how the visit
  // failed. Re-parsing the source is only the fallback for a URL with no
  // prior rendering, which has no row to protect but should still surface
  // its failure as an instance error when it's a card.
  let isCardInstance =
    batch.prerenderedHtmlTombstonedLiveTypes(url.href)?.includes('instance') ??
    false;
  if (!isCardInstance && url.href.endsWith('.json')) {
    try {
      let fileRef = await reader.readFile(url);
      let resource = fileRef?.content
        ? (JSON.parse(fileRef.content)?.data as unknown)
        : undefined;
      isCardInstance = Boolean(resource && isCardResource(resource));
    } catch (parseErr) {
      log.warn(
        `${jobIdentity(jobInfo)} could not determine whether ${url.href} is a card instance after its visit failed: ${(parseErr as Error)?.message}`,
      );
    }
  }
  if (isCardInstance) {
    await batch.updatePrerenderedHtmlEntry(url, {
      type: 'instance-error',
      error,
    });
    stats.instanceErrors++;
  }
}
