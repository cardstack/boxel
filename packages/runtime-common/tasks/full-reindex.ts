import type * as JSONTypes from 'json-typescript';
import type { Task } from './index.ts';

import {
  jobIdentity,
  fetchAllRealmsWithOwners,
  systemInitiatedPriority,
} from '../index.ts';
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

    for (let target of realmsWithUsernames) {
      let { realmUrl, realmUsername } = target;
      try {
        await enqueueReindexRealmJob(
          realmUrl,
          realmUsername,
          queuePublisher,
          dbAdapter,
          systemInitiatedPriority,
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
