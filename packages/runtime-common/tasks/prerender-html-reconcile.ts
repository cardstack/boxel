import type * as JSONTypes from 'json-typescript';
import type { Task } from './index.ts';
import {
  fetchAllRealmsWithOwners,
  getMatrixUsername,
  isPublishedRealmAccount,
  jobIdentity,
  systemInitiatedPriority,
} from '../index.ts';
import type { QueuePublisher } from '../queue.ts';
import {
  registerQueueJobDefinition,
  type QueueCoalesceContext,
  type QueueCoalesceDecision,
} from '../queue.ts';
import {
  enqueuePrerenderHtmlJob,
  skipsPrerenderHtml,
} from '../jobs/prerender-html.ts';
import { FROM_SCRATCH_JOB_TIMEOUT_SEC } from './indexer.ts';
import {
  INCREMENTAL_INDEX_JOB_TIMEOUT_SEC,
  indexingConcurrencyGroup,
  makeIncrementalArgsWithCallerMetadata,
  systemInitiatedIndexPriority,
} from '../jobs/indexing.ts';
import { isUserOfMatrixServer } from '../matrix-server-name.ts';
import {
  fetchRealmGenerations,
  findActivePrerenderHtmlJobCoverage,
  findPrerenderHtmlRejectionStreaks,
  findStalePrerenderedHtmlRows,
  findTransientIndexRetryRows,
  findTransientRetryPrerenderedHtmlRows,
  planPrerenderHtmlRepairs,
  prerenderHtmlRepairBackoffMs,
  type PrerenderHtmlRejectionStreak,
  type StalePrerenderedHtmlRow,
} from '../prerender-html-reconcile.ts';

// The hourly cron enqueues this job with no arguments: the whole sweep, over
// every realm. The every-minute cron enqueues it with `transientOnly: true`:
// only the transient-render-failure retries, on both channels, so a retry
// starts within about a minute of falling due rather than at the next hourly
// sweep. That scan reads only the stamped rows (their partial indexes) and the
// jobs since each one's last write, so it costs little when nothing failed.
type PrerenderHtmlReconcileArgs = JSONTypes.Object & {
  transientOnly?: boolean;
};

function isTransientOnly(args: unknown): boolean {
  return (
    !!args &&
    typeof args === 'object' &&
    (args as { transientOnly?: unknown }).transientOnly === true
  );
}

export interface PrerenderHtmlReconcileResult extends JSONTypes.Object {
  realmsRepaired: number;
  urlsEnqueued: number;
  // Realms with repairable residue that were skipped this scan because their
  // prerender_html jobs' rejection streak has them waiting out a backoff
  // interval (see `prerenderHtmlRepairBackoffMs`).
  realmsInBackoff: number;
  // Also `indexRetriesEnqueued`, when there were any: the URLs re-indexed
  // because their index visit failed transiently and is due a retry
  // (`findTransientIndexRetryRows`). Not declared, since the JSON index
  // signature admits no optional member.
}

export { prerenderHtmlReconcile };

// The fixed concurrency group already serializes execution to one scan at a
// time; this additionally collapses a queued tick into any pending or in-flight
// scan that covers it, so overlapping cron ticks never pile up. The scan
// carries no per-realm args, so there is nothing to merge: a twin covers the
// tick when its scan is at least as wide. The whole sweep covers a
// transient-only tick; a transient-only scan does not cover the whole sweep,
// which is then queued behind it.
export function choosePrerenderHtmlReconcileCoalesceDecision(
  context: QueueCoalesceContext,
): QueueCoalesceDecision {
  let { incoming, candidates, inFlightCandidates } = context;
  let covers = (candidate: (typeof candidates)[number]) =>
    candidate.jobType === incoming.jobType &&
    (!isTransientOnly(candidate.args) || isTransientOnly(incoming.args));
  let twin = candidates.find(covers) ?? inFlightCandidates.find(covers);
  if (!twin) {
    return { type: 'insert' };
  }
  return { type: 'join', jobId: twin.id };
}

registerQueueJobDefinition({
  jobType: 'prerender-html-reconcile',
  coalesce: choosePrerenderHtmlReconcileCoalesceDecision,
});

// Catch-up sweep for the residue the queue's own durability does not cover: a
// prerender_html job whose enqueue was lost between the generation commit and
// the publish, or whose swap lost a race, leaves index rows stale with nothing
// scheduled to repair them. Job death itself is the queue's problem (lease
// expiry re-runs it), so this sweep only enqueues repair where no queued or
// running job already covers the row. Two bounds keep repeated failure from
// poisoning the prerender fleet: a realm whose repair jobs keep rejecting is
// deferred on the rejection-streak backoff schedule (a persistent whole-job
// failure retries a few times a day instead of burning a render batch every
// scan), and an individual URL whose visit requests keep failing is retried
// only up to its consecutive-failure cap before its recorded error stands
// (see `findStalePrerenderedHtmlRows`). The same scan also retries healthy
// rows whose declared captures failed (recorded on
// `diagnostics.captureErrors`, never as an error row), capped on that
// lane's row-level failing-render counter. Purely additive: a sweep over a
// healthy system finds nothing and enqueues nothing.
const prerenderHtmlReconcile: Task<
  PrerenderHtmlReconcileArgs,
  PrerenderHtmlReconcileResult
> = ({
  dbAdapter,
  queuePublisher,
  reportStatus,
  log,
  skipPrerenderHtmlRealms,
  matrixServerName,
}) =>
  async function (args) {
    let { jobInfo } = args;
    let transientOnly = isTransientOnly(args);
    reportStatus(jobInfo, 'start');

    let indexRetriesEnqueued = await retryTransientIndexFailures({
      dbAdapter,
      queuePublisher,
      log,
      matrixServerName,
      jobLabel: jobIdentity(jobInfo),
      // The legacy rows' one re-index reads the errored rows, which is the
      // hourly sweep's to do.
      includeLegacy: !transientOnly,
    });

    let transientRows = await findTransientRetryPrerenderedHtmlRows(dbAdapter);
    let staleRows = transientOnly
      ? transientRows
      : withoutDuplicateRows([
          ...(await findStalePrerenderedHtmlRows(dbAdapter)),
          ...transientRows,
        ]);
    if (staleRows.length === 0) {
      log.debug(
        `${jobIdentity(jobInfo)} prerender-html reconcile: no stale rows`,
      );
      reportStatus(jobInfo, 'finish');
      return {
        realmsRepaired: 0,
        urlsEnqueued: 0,
        realmsInBackoff: 0,
        ...(indexRetriesEnqueued > 0 ? { indexRetriesEnqueued } : {}),
      };
    }

    let coverage = await findActivePrerenderHtmlJobCoverage(dbAdapter);
    let plan = planPrerenderHtmlRepairs(staleRows, coverage);
    if (plan.size === 0) {
      log.debug(
        `${jobIdentity(jobInfo)} prerender-html reconcile: ${staleRows.length} stale row(s), all covered by active prerender_html jobs`,
      );
      reportStatus(jobInfo, 'finish');
      return {
        realmsRepaired: 0,
        urlsEnqueued: 0,
        realmsInBackoff: 0,
        ...(indexRetriesEnqueued > 0 ? { indexRetriesEnqueued } : {}),
      };
    }

    // A transient retry's repair that dies counts as one of the row's
    // attempts (`findTransientRetryPrerenderedHtmlRows`), which bounds it per
    // row; the realm-wide rejection streak, a scan of two days of finished
    // jobs, is the hourly sweep's.
    let rejectionStreaks = transientOnly
      ? new Map<string, PrerenderHtmlRejectionStreak>()
      : await findPrerenderHtmlRejectionStreaks(dbAdapter, [...plan.keys()]);
    let generations = await fetchRealmGenerations(dbAdapter);
    let realmOwners = await fetchAllRealmsWithOwners(
      dbAdapter,
      matrixServerName,
    );
    let ownerByRealm = new Map(
      realmOwners.map((realm) => [realm.realm_url, realm.owner_user_id]),
    );

    let realmsRepaired = 0;
    let urlsEnqueued = 0;
    let realmsInBackoff = 0;
    for (let [realmURL, urls] of plan) {
      // A realm configured to render no HTML has every row permanently
      // unrendered, which is indistinguishable here from residue worth
      // repairing — `ph.url IS NULL` is the first staleness condition. Without
      // this the sweep would re-enqueue on every tick the very render the
      // configuration exists to prevent, at whole-realm size.
      if (skipsPrerenderHtml(realmURL, skipPrerenderHtmlRealms)) {
        log.debug(
          `${jobIdentity(jobInfo)} prerender-html reconcile: skipping realm configured not to render: ${realmURL} (${urls.length} unrendered url(s))`,
        );
        continue;
      }
      // Render as the realm's owner, mirroring how an index pass spawns the
      // prerender job. Realms owned only by their own published-realm account
      // are re-enqueued by the deploy-time from-scratch reindex, so their
      // residue self-heals on deploy rather than here — the same scoping
      // full-reindex uses.
      let owner = ownerByRealm.get(realmURL);
      if (!owner || isPublishedRealmAccount(owner, matrixServerName)) {
        // Debug, not warn: a bot-owned realm's residue is expected to heal on
        // the next deploy reindex, so this fires every tick until then and is
        // not actionable on its own.
        log.debug(
          `${jobIdentity(jobInfo)} prerender-html reconcile: skipping realm without a non-bot owner: ${realmURL} (${urls.length} stale url(s))`,
        );
        continue;
      }
      // A prerender job names the user it runs as by localpart, which the
      // worker qualifies with its own server name. For an owner on another
      // homeserver that would name a different account, so the realm is
      // skipped.
      if (!isUserOfMatrixServer(owner, matrixServerName)) {
        log.warn(
          `${jobIdentity(jobInfo)} prerender-html reconcile: skipping realm whose owner is on another homeserver: ${realmURL} (${urls.length} stale url(s))`,
        );
        continue;
      }
      let realmGeneration = generations.get(realmURL);
      if (!realmGeneration) {
        log.debug(
          `${jobIdentity(jobInfo)} prerender-html reconcile: skipping realm without a generation row: ${realmURL} (${urls.length} stale url(s))`,
        );
        continue;
      }
      let streak = rejectionStreaks.get(realmURL);
      if (streak) {
        let backoffMs = prerenderHtmlRepairBackoffMs(
          streak.consecutiveRejections,
        );
        if (streak.msSinceLastRejection < backoffMs) {
          realmsInBackoff++;
          // Info, not debug: this is the operator's signal that a realm's
          // HTML repair keeps failing wholesale — the per-URL error rows
          // cover render failures, so a streak here points at something
          // job-level (upstream outage, job timeout).
          log.info(
            `${jobIdentity(jobInfo)} prerender-html reconcile: deferring repair for ${realmURL} (${urls.length} stale url(s)): ` +
              `${streak.consecutiveRejections} consecutive rejected prerender_html job(s), ` +
              `next attempt eligible in ${Math.ceil((backoffMs - streak.msSinceLastRejection) / 60_000)} minute(s)`,
          );
          continue;
        }
      }
      try {
        await enqueuePrerenderHtmlJob(queuePublisher, {
          realmURL,
          // The owner is on the worker's server, so the worker qualifies this
          // localpart back to the owner's id.
          realmUsername: getMatrixUsername(owner),
          changes: urls.map((url) => ({ url, operation: 'update' as const })),
          // Spawned from committed state: no index pass to wait on.
          spawningIndexPasses: [],
          generation: realmGeneration.generation,
          loaderEpoch: realmGeneration.loaderEpoch,
          spawningJobId: jobInfo?.jobId ?? null,
          // A system-initiated spawn drops to priority 0 — the background tier
          // that never competes with indexing or user work.
          spawningPriority: systemInitiatedPriority,
          timeoutSec: FROM_SCRATCH_JOB_TIMEOUT_SEC,
          // Targeted repair of specific stale/missing rows, not a from-scratch:
          // skip the O(realm) pre-warm sweep. Any mid-render `lookupDefinition`
          // falls back to the on-demand read-through.
          preWarm: false,
        });
        realmsRepaired++;
        urlsEnqueued += urls.length;
      } catch (error: any) {
        log.error(
          `${jobIdentity(jobInfo)} prerender-html reconcile: failed to enqueue repair for ${realmURL}`,
          error,
        );
        continue;
      }
    }

    log.info(
      `${jobIdentity(jobInfo)} prerender-html reconcile${transientOnly ? ' (transient retries)' : ''}: enqueued repair for ${urlsEnqueued} url(s) across ${realmsRepaired} realm(s) (from ${staleRows.length} stale row(s), ${realmsInBackoff} realm(s) in backoff)`,
    );
    reportStatus(jobInfo, 'finish');
    return {
      realmsRepaired,
      urlsEnqueued,
      realmsInBackoff,
      ...(indexRetriesEnqueued > 0 ? { indexRetriesEnqueued } : {}),
    };
  };

// How many retried URLs one sweep's log line names. The sweep runs every
// minute, so the line names a sample, not a backlog.
const LOGGED_RETRY_URLS_MAX = 20;

// The index pass's half of the transient-failure retries: each realm's index
// rows due a retry (`findTransientIndexRetryRows`) are re-indexed by one
// incremental pass over exactly those URLs, run as the realm's owner at the
// system tier, the way any other repair is. Each attempt's write extends the
// row's run or ends it, so the cap and the backoff bound the retries. Answers
// how many URLs it enqueued.
async function retryTransientIndexFailures({
  dbAdapter,
  queuePublisher,
  log,
  matrixServerName,
  jobLabel,
  includeLegacy,
}: {
  dbAdapter: Parameters<typeof findTransientIndexRetryRows>[0];
  includeLegacy: boolean;
  queuePublisher: QueuePublisher;
  log: {
    info(message: string): void;
    error(message: string, e?: unknown): void;
  };
  matrixServerName: string;
  jobLabel: string;
}): Promise<number> {
  let due = await findTransientIndexRetryRows(dbAdapter, { includeLegacy });
  if (due.size === 0) {
    return 0;
  }
  let owners = new Map(
    (await fetchAllRealmsWithOwners(dbAdapter, matrixServerName)).map(
      (realm) => [realm.realm_url, realm.owner_user_id],
    ),
  );
  let enqueued = 0;
  // Each retry is an index pass the realm's `_readiness-check` waits on, so
  // the URLs it names are what explains a realm reading not-ready after its
  // boot index finished.
  let retried: string[] = [];
  for (let [realmURL, urls] of due) {
    let owner = owners.get(realmURL);
    if (
      !owner ||
      isPublishedRealmAccount(owner, matrixServerName) ||
      !isUserOfMatrixServer(owner, matrixServerName)
    ) {
      continue;
    }
    try {
      await queuePublisher.publish({
        jobType: 'incremental-index',
        concurrencyGroup: indexingConcurrencyGroup(realmURL),
        timeout: INCREMENTAL_INDEX_JOB_TIMEOUT_SEC,
        priority: systemInitiatedIndexPriority(realmURL),
        args: makeIncrementalArgsWithCallerMetadata(
          {
            realmURL,
            realmUsername: getMatrixUsername(owner),
            changes: urls.map((url) => ({ url, operation: 'update' as const })),
            ignoreData: {},
          },
          null,
        ),
      });
      enqueued += urls.length;
      for (let url of urls) {
        if (retried.length >= LOGGED_RETRY_URLS_MAX) {
          break;
        }
        retried.push(url);
      }
    } catch (error: any) {
      log.error(
        `${jobLabel} prerender-html reconcile: failed to enqueue the index retry of ${urls.length} url(s) in ${realmURL}`,
        error,
      );
    }
  }
  log.info(
    `${jobLabel} prerender-html reconcile: enqueued index retries of ${enqueued} url(s) whose visits failed transiently` +
      (retried.length
        ? `: ${retried.join(', ')}` +
          (enqueued > retried.length
            ? ` and ${enqueued - retried.length} more`
            : '')
        : ''),
  );
  return enqueued;
}

// The stale rows and the transient retries overlap when a row is both behind
// its index row and stamped; it is repaired once.
function withoutDuplicateRows(
  rows: StalePrerenderedHtmlRow[],
): StalePrerenderedHtmlRow[] {
  let seen = new Set<string>();
  return rows.filter((row) => {
    let key = `${row.realmURL} ${row.url}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
