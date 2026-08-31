import type * as JSONTypes from 'json-typescript';
import type { Task } from './index.ts';

import { jobIdentity, fetchAllRealmsWithOwners } from '../index.ts';
import { systemInitiatedIndexPriority } from '../jobs/indexing.ts';
import {
  type QueueCoalesceContext,
  type QueueCoalesceDecision,
  registerQueueJobDefinition,
} from '../queue.ts';

import { enqueueReindexRealmJob } from '../jobs/reindex-realm.ts';

export interface RealmReindexTarget extends JSONTypes.Object {
  realmUrl: string;
  realmUsername: string;
}

interface FullReindexArgs {
  realmUrls: string[];
}

export { fullReindex };

// A full reindex enqueues one from-scratch job per realm and does not wait for
// any of them, so its cost is a DB round trip per realm and grows with the
// realm count — a couple of seconds per realm in practice, and observed as high
// as 398s against a previous 360s budget.
//
// The budget is deliberately generous relative to that. The failure mode of
// aborting early is silent: the realms the fan-out never reached are simply
// left un-reindexed, with nothing to retry them. And it costs little, because
// `full-reindex-group` is used by no other job type, so a long lease delays
// only the next full reindex — which coalesces into this one anyway.
//
// A worker clamps any declared timeout to its own ceiling, so raising this
// above `FROM_SCRATCH_JOB_TIMEOUT_SEC` would silently have no effect.
export const FULL_REINDEX_JOB_TIMEOUT_SEC = 30 * 60;

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getRealmUrls(args: unknown): string[] {
  if (!isObjectLike(args)) {
    return [];
  }
  let urls = args.realmUrls;
  if (!Array.isArray(urls)) {
    return [];
  }
  return urls.filter((url): url is string => typeof url === 'string');
}

function chooseFullReindexCoalesceDecision(
  context: QueueCoalesceContext,
): QueueCoalesceDecision {
  let { incoming, candidates } = context;
  let twin = candidates.find(
    (candidate) => candidate.jobType === incoming.jobType,
  );
  if (!twin) {
    return { type: 'insert' };
  }
  // Post-deployment hooks fire on every realm-server instance. Two concurrent
  // enqueues converge into one full-reindex with the union of realmUrls so we
  // don't double the per-deploy reindex cost.
  let merged = [
    ...new Set([...getRealmUrls(twin.args), ...getRealmUrls(incoming.args)]),
  ];
  return {
    type: 'join',
    jobId: twin.id,
    update: {
      priority: Math.max(twin.priority, incoming.priority),
      timeout: Math.max(twin.timeout, incoming.timeout),
      args: {
        ...(isObjectLike(twin.args) ? twin.args : {}),
        ...(isObjectLike(incoming.args) ? incoming.args : {}),
        realmUrls: merged,
      },
    },
  };
}

registerQueueJobDefinition({
  jobType: 'full-reindex',
  coalesce: chooseFullReindexCoalesceDecision,
});

const fullReindex: Task<FullReindexArgs, void> = ({
  reportStatus,
  log,
  dbAdapter,
  queuePublisher,
}) =>
  async function (args) {
    let { jobInfo, realmUrls } = args;
    log.debug(
      `${jobIdentity(jobInfo)} starting reindex-all for job: ${JSON.stringify(args)}`,
    );
    reportStatus(jobInfo, 'start');

    const realmOwners = await fetchAllRealmsWithOwners(dbAdapter);

    const ownerMap = new Map(
      realmOwners.map((r) => [r.realm_url, r.owner_username]),
    );

    // Only include realms with a non-bot owner
    const realmsWithUsernames = realmUrls
      .map((realmUrl) => {
        const username = ownerMap.get(realmUrl);
        if (!username) {
          log.warn(
            `${jobIdentity(jobInfo)} skipping realm without owner: ${realmUrl}`,
          );
          return null;
        }
        return {
          realmUrl,
          realmUsername: username,
        };
      })
      .filter((realm): realm is RealmReindexTarget => realm !== null)
      .filter((realm) => !realm.realmUsername.startsWith('realm/'));

    if (realmsWithUsernames.length === 0) {
      log.debug(
        `${jobIdentity(jobInfo)} no eligible realms found for full reindex`,
      );
      reportStatus(jobInfo, 'finish');
      return;
    }

    // Enqueued in the order the urls arrived: workers claim jobs within a
    // priority pool in strict arrival order, so this loop's order is the
    // queue's order. `getFullReindexRealmUrls` sorts the dependency-root
    // realms to the front for that reason, and the `full-reindex` coalesce
    // merges two sweeps' urls first-occurrence-wins, which preserves it.
    for (let target of realmsWithUsernames) {
      let { realmUrl, realmUsername } = target;
      try {
        await enqueueReindexRealmJob(
          realmUrl,
          realmUsername,
          queuePublisher,
          dbAdapter,
          systemInitiatedIndexPriority(realmUrl),
          {
            clearLastModified: true,
          },
        );
      } catch (error: any) {
        log.error(
          `${jobIdentity(jobInfo)} failed to enqueue from-scratch job for ${realmUrl}`,
          error,
        );
        continue;
      }
    }

    reportStatus(jobInfo, 'finish');
  };
