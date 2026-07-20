import type * as JSONTypes from 'json-typescript';
import type { Task } from './index.ts';
import {
  fetchAllRealmsWithOwners,
  jobIdentity,
  systemInitiatedPriority,
} from '../index.ts';
import {
  registerQueueJobDefinition,
  type QueueCoalesceContext,
  type QueueCoalesceDecision,
} from '../queue.ts';
import { enqueuePrerenderHtmlJob } from '../jobs/prerender-html.ts';
import { FROM_SCRATCH_JOB_TIMEOUT_SEC } from './indexer.ts';
import {
  fetchRealmGenerations,
  findActivePrerenderHtmlJobCoverage,
  findPrerenderHtmlRejectionStreaks,
  findStalePrerenderedHtmlRows,
  planPrerenderHtmlRepairs,
  prerenderHtmlRepairBackoffMs,
} from '../prerender-html-reconcile.ts';

// The cron enqueues this job with no arguments; it scans every realm.
type PrerenderHtmlReconcileArgs = JSONTypes.Object;

export interface PrerenderHtmlReconcileResult extends JSONTypes.Object {
  realmsRepaired: number;
  urlsEnqueued: number;
  // Realms with repairable residue that were skipped this scan because their
  // prerender_html jobs' rejection streak has them waiting out a backoff
  // interval (see `prerenderHtmlRepairBackoffMs`).
  realmsInBackoff: number;
}

export { prerenderHtmlReconcile };

// The fixed concurrency group already serializes execution to one scan at a
// time; this additionally collapses a queued tick into any pending or in-flight
// scan so overlapping cron ticks never pile up. The scan carries no per-realm
// args, so there is nothing to merge — a twin simply wins.
function choosePrerenderHtmlReconcileCoalesceDecision(
  context: QueueCoalesceContext,
): QueueCoalesceDecision {
  let { incoming, candidates, inFlightCandidates } = context;
  let twin =
    candidates.find((candidate) => candidate.jobType === incoming.jobType) ??
    inFlightCandidates.find(
      (candidate) => candidate.jobType === incoming.jobType,
    );
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
// running job already covers the row — and a realm whose repair jobs keep
// rejecting is deferred on the rejection-streak backoff schedule, so a
// persistent whole-job failure is retried a few times a day instead of
// burning a full render batch every scan. Purely additive: a sweep over a
// healthy system finds nothing and enqueues nothing.
const prerenderHtmlReconcile: Task<
  PrerenderHtmlReconcileArgs,
  PrerenderHtmlReconcileResult
> = ({ dbAdapter, queuePublisher, reportStatus, log }) =>
  async function (args) {
    let { jobInfo } = args;
    reportStatus(jobInfo, 'start');

    let staleRows = await findStalePrerenderedHtmlRows(dbAdapter);
    if (staleRows.length === 0) {
      log.debug(
        `${jobIdentity(jobInfo)} prerender-html reconcile: no stale rows`,
      );
      reportStatus(jobInfo, 'finish');
      return { realmsRepaired: 0, urlsEnqueued: 0, realmsInBackoff: 0 };
    }

    let coverage = await findActivePrerenderHtmlJobCoverage(dbAdapter);
    let plan = planPrerenderHtmlRepairs(staleRows, coverage);
    if (plan.size === 0) {
      log.debug(
        `${jobIdentity(jobInfo)} prerender-html reconcile: ${staleRows.length} stale row(s), all covered by active prerender_html jobs`,
      );
      reportStatus(jobInfo, 'finish');
      return { realmsRepaired: 0, urlsEnqueued: 0, realmsInBackoff: 0 };
    }

    let rejectionStreaks = await findPrerenderHtmlRejectionStreaks(dbAdapter, [
      ...plan.keys(),
    ]);
    let generations = await fetchRealmGenerations(dbAdapter);
    let realmOwners = await fetchAllRealmsWithOwners(dbAdapter);
    let ownerByRealm = new Map(
      realmOwners.map((realm) => [realm.realm_url, realm.owner_username]),
    );

    let realmsRepaired = 0;
    let urlsEnqueued = 0;
    let realmsInBackoff = 0;
    for (let [realmURL, urls] of plan) {
      // Render as the realm's owner, mirroring how an index pass spawns the
      // prerender job. Realms owned only by a bot (`realm/…`) are re-enqueued
      // by the deploy-time from-scratch reindex, so their residue self-heals on
      // deploy rather than here — the same scoping full-reindex uses.
      let owner = ownerByRealm.get(realmURL);
      if (!owner || owner.startsWith('realm/')) {
        // Debug, not warn: a bot-owned realm's residue is expected to heal on
        // the next deploy reindex, so this fires every tick until then and is
        // not actionable on its own.
        log.debug(
          `${jobIdentity(jobInfo)} prerender-html reconcile: skipping realm without a non-bot owner: ${realmURL} (${urls.length} stale url(s))`,
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
          realmUsername: owner,
          changes: urls.map((url) => ({ url, operation: 'update' as const })),
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
      `${jobIdentity(jobInfo)} prerender-html reconcile: enqueued repair for ${urlsEnqueued} url(s) across ${realmsRepaired} realm(s) (from ${staleRows.length} stale row(s), ${realmsInBackoff} realm(s) in backoff)`,
    );
    reportStatus(jobInfo, 'finish');
    return { realmsRepaired, urlsEnqueued, realmsInBackoff };
  };
