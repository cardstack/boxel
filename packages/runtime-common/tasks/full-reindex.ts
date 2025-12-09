import type * as JSONTypes from 'json-typescript';
import type { Task } from './index';

import {
  jobIdentity,
  fetchAllRealmsWithOwners,
  systemInitiatedPriority,
} from '../index';

import { enqueueReindexRealmJob } from '../jobs/reindex-realm';

export interface RealmReindexTarget extends JSONTypes.Object {
  realmUrl: string;
  realmUsername: string;
}

interface FullReindexArgs {
  realmUrls: string[];
}

export { fullReindex };

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

    for (let target of realmsWithUsernames) {
      let { realmUrl, realmUsername } = target;
      try {
        await enqueueReindexRealmJob(
          realmUrl,
          realmUsername,
          queuePublisher,
          dbAdapter,
          systemInitiatedPriority,
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
