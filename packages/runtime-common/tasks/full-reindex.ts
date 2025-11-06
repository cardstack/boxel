import type * as JSONTypes from 'json-typescript';
import type { Task } from './index';
// TODO import this from sibling module
import type { FromScratchResult } from '../worker';

import {
  jobIdentity,
  fetchAllRealmsWithOwners,
  systemInitiatedPriority,
  normalizeFullReindexBatchSize,
  fullReindexBatchTimeoutSeconds,
  normalizeFullReindexCooldownSeconds,
  type Job,
} from '../index';

import { enqueueReindexRealmJob } from '../jobs/reindex-realm';

export interface RealmReindexTarget extends JSONTypes.Object {
  realmUrl: string;
  realmUsername: string;
}

interface FullReindexArgs {
  realmUrls: string[];
  concurrency: number;
  batchSize?: number;
  cooldownSeconds?: number;
}
interface FullReindexBatchArgs extends JSONTypes.Object {
  realms: RealmReindexTarget[];
  cooldownSeconds: number;
  batchNumber: number;
  totalBatches: number;
}
export const FULL_REINDEX_BATCH_JOB = 'full-reindex-batch';
const FULL_REINDEX_BATCH_CONCURRENCY_GROUP = 'full-reindex-group';

export { fullReindex, fullReindexBatch };

const fullReindex: Task<FullReindexArgs, void> = ({
  reportStatus,
  log,
  dbAdapter,
  queuePublisher,
}) =>
  async function (args) {
    let { jobInfo, realmUrls, concurrency } = args;
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
        const username = ownerMap.get(realmUrl)!;
        return {
          realmUrl,
          realmUsername: username,
        };
      })
      .filter((realm) => !realm.realmUsername.startsWith('@realm/'));

    if (realmsWithUsernames.length === 0) {
      log.debug(
        `${jobIdentity(jobInfo)} no eligible realms found for full reindex`,
      );
      reportStatus(jobInfo, 'finish');
      return;
    }

    let batchSize = normalizeFullReindexBatchSize(args.batchSize);
    let cooldownSeconds = normalizeFullReindexCooldownSeconds(
      args.cooldownSeconds,
    );

    let batches: RealmReindexTarget[][] = [];
    for (let i = 0; i < realmsWithUsernames.length; i += batchSize) {
      batches.push(realmsWithUsernames.slice(i, i + batchSize));
    }

    let totalBatches = batches.length;
    for (let [index, batch] of batches.entries()) {
      if (batch.length === 0) {
        continue;
      }
      let timeout = fullReindexBatchTimeoutSeconds(
        batch.length,
        cooldownSeconds,
      );
      let concurrencySuffix = (index % concurrency) + 1;
      await queuePublisher.publish<void>({
        jobType: FULL_REINDEX_BATCH_JOB,
        concurrencyGroup: `${FULL_REINDEX_BATCH_CONCURRENCY_GROUP}-${concurrencySuffix}`,
        timeout,
        priority: systemInitiatedPriority,
        args: {
          realms: batch,
          cooldownSeconds,
          batchNumber: index + 1,
          totalBatches,
        },
      });
    }

    log.info(
      `${jobIdentity(jobInfo)} scheduled full reindex for ${realmsWithUsernames.length} realm(s) across ${totalBatches} batch(es) with batch size ${batchSize} and cooldown ${cooldownSeconds}s`,
    );

    reportStatus(jobInfo, 'finish');
  };

const fullReindexBatch: Task<FullReindexBatchArgs, void> = ({
  reportStatus,
  log,
  dbAdapter,
  queuePublisher,
}) =>
  async function (args) {
    let { jobInfo, totalBatches, batchNumber, realms } = args;
    log.debug(
      `${jobIdentity(jobInfo)} starting full-reindex batch for job: ${JSON.stringify(
        args,
      )}`,
    );
    reportStatus(jobInfo, 'start');

    let cooldownSeconds = normalizeFullReindexCooldownSeconds(
      args.cooldownSeconds,
    );
    let cooldownMs =
      cooldownSeconds > 0 ? Math.floor(cooldownSeconds * 1000) : 0;

    let enqueueFailures: { target: RealmReindexTarget; error: Error }[] = [];
    let completedCount = 0;
    let failedRuns: {
      target: RealmReindexTarget;
      error: Error;
    }[] = [];

    let batchLabel = `batch ${batchNumber}/${totalBatches}`;

    log.info(
      `${jobIdentity(jobInfo)} starting ${batchLabel} with ${realms.length} realm(s)`,
    );

    for (let index = 0; index < realms.length; index++) {
      let target = realms[index];
      let job: Job<FromScratchResult> | undefined;
      try {
        job = await enqueueReindexRealmJob(
          target.realmUrl,
          target.realmUsername,
          queuePublisher,
          dbAdapter,
          systemInitiatedPriority,
        );
      } catch (error: any) {
        log.error(
          `${jobIdentity(jobInfo)} failed to enqueue from-scratch job for ${target.realmUrl}`,
          error,
        );
        enqueueFailures.push({
          target,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        continue;
      }

      try {
        await job.done;
        completedCount++;
      } catch (error: any) {
        let normalizedError =
          error instanceof Error ? error : new Error(String(error));
        log.error(
          `${jobIdentity(jobInfo)} from-scratch job for ${target.realmUrl} rejected`,
          normalizedError,
        );
        failedRuns.push({ target, error: normalizedError });
      }

      if (index < realms.length - 1 && cooldownMs > 0) {
        await sleep(cooldownMs);
      }
    }

    if (failedRuns.length > 0 || enqueueFailures.length > 0) {
      let totalFailures = failedRuns.length + enqueueFailures.length;
      log.warn(
        `${jobIdentity(jobInfo)} full-reindex batch completed with ${totalFailures} failure(s) (${failedRuns.length} runtime, ${enqueueFailures.length} enqueue)`,
      );
      let failureSummary = [
        enqueueFailures.length
          ? `${enqueueFailures.length} enqueue failure(s)`
          : null,
        failedRuns.length ? `${failedRuns.length} runtime failure(s)` : null,
      ]
        .filter(Boolean)
        .join(', ');
      throw new Error(
        `${jobIdentity(jobInfo)} full-reindex batch had ${failureSummary}`,
      );
    } else {
      log.info(
        `${jobIdentity(jobInfo)} completed ${batchLabel} for ${completedCount} realm(s)`,
      );
    }

    reportStatus(jobInfo, 'finish');
  };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}
