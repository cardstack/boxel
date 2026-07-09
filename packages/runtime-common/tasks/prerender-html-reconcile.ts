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
  findStalePrerenderedHtmlRows,
  planPrerenderHtmlRepairs,
} from '../prerender-html-reconcile.ts';

// The cron enqueues this job with no arguments; it scans every realm.
type PrerenderHtmlReconcileArgs = JSONTypes.Object;

export interface PrerenderHtmlReconcileResult extends JSONTypes.Object {
  realmsRepaired: number;
  urlsEnqueued: number;
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
// running job already covers the row. Purely additive: a sweep over a healthy
// system finds nothing and enqueues nothing.
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
      return { realmsRepaired: 0, urlsEnqueued: 0 };
    }

    let coverage = await findActivePrerenderHtmlJobCoverage(dbAdapter);
    let plan = planPrerenderHtmlRepairs(staleRows, coverage);
    if (plan.size === 0) {
      log.debug(
        `${jobIdentity(jobInfo)} prerender-html reconcile: ${staleRows.length} stale row(s), all covered by active prerender_html jobs`,
      );
      reportStatus(jobInfo, 'finish');
      return { realmsRepaired: 0, urlsEnqueued: 0 };
    }

    let generations = await fetchRealmGenerations(dbAdapter);
    let realmOwners = await fetchAllRealmsWithOwners(dbAdapter);
    let ownerByRealm = new Map(
      realmOwners.map((realm) => [realm.realm_url, realm.owner_username]),
    );

    let realmsRepaired = 0;
    let urlsEnqueued = 0;
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
      `${jobIdentity(jobInfo)} prerender-html reconcile: enqueued repair for ${urlsEnqueued} url(s) across ${realmsRepaired} realm(s) (from ${staleRows.length} stale row(s))`,
    );
    reportStatus(jobInfo, 'finish');
    return { realmsRepaired, urlsEnqueued };
  };
