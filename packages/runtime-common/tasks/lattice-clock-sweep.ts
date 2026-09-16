import type * as JSONTypes from 'json-typescript';
import type { Task } from './index.ts';
import {
  jobIdentity,
  query,
  param,
  systemInitiatedPriority,
} from '../index.ts';
import { getMatrixUsername } from '../matrix-client.ts';
import {
  INCREMENTAL_INDEX_JOB_TIMEOUT_SEC,
  indexingConcurrencyGroup,
  makeIncrementalArgsWithCallerMetadata,
  mapIncrementalDoneResult,
} from '../jobs/indexing.ts';

export interface LatticeClockSweepArgs extends JSONTypes.Object {
  // Cards re-indexed by one sweep (0 for the default); the rest wait for the
  // next tick. Required so the args satisfy WorkerArgs's JSON-shape index.
  limit: number;
}

export { latticeClockSweep };

// Time grain: a clock-reading computed stores the earliest boundary at which
// its value next changes (boxel_index.valid_until). This sweep re-indexes the
// rows whose boundary has passed, as ordinary incremental index jobs for the
// realm, so the value is re-derived exactly when it can differ and never
// before. Idempotent: a row re-indexed before the sweep runs has a new
// boundary; a pending job for the same URL coalesces.
const latticeClockSweep: Task<LatticeClockSweepArgs, { enqueued: number }> = ({
  dbAdapter,
  queuePublisher,
  log,
  reportStatus,
}) =>
  async function (args) {
    let { jobInfo } = args;
    reportStatus(jobInfo, 'start');
    let limit =
      Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 200;
    let rows = await query(dbAdapter, [
      `SELECT i.realm_url, i.url, p.username FROM boxel_index i
         JOIN realm_user_permissions p ON p.realm_url = i.realm_url AND p.realm_owner = TRUE
        WHERE i.type = 'instance' AND i.valid_until IS NOT NULL AND i.valid_until <= now()
          AND i.is_deleted IS NOT TRUE
        ORDER BY i.realm_url, i.valid_until LIMIT`,
      param(limit),
    ]);
    let byRealm = new Map<string, { username: string; urls: string[] }>();
    for (let row of rows) {
      let realmURL = String(row.realm_url);
      let entry = byRealm.get(realmURL);
      if (!entry) {
        // Jobs carry the realm owner's bare Matrix username (as the realm's
        // own index jobs do), not the @user:server id stored in permissions.
        entry = { username: getMatrixUsername(String(row.username)), urls: [] };
        byRealm.set(realmURL, entry);
      }
      if (!entry.urls.includes(String(row.url)))
        entry.urls.push(String(row.url));
    }
    let enqueued = 0;
    for (let [realmURL, { username, urls }] of byRealm) {
      await queuePublisher.publish({
        jobType: 'incremental-index',
        concurrencyGroup: indexingConcurrencyGroup(realmURL),
        timeout: INCREMENTAL_INDEX_JOB_TIMEOUT_SEC,
        priority: systemInitiatedPriority,
        args: makeIncrementalArgsWithCallerMetadata(
          {
            realmURL,
            realmUsername: username,
            changes: urls.map((url) => ({ url, operation: 'update' as const })),
            ignoreData: {},
          },
          null,
        ),
        mapResult: mapIncrementalDoneResult(null),
      });
      enqueued += urls.length;
      log.info(
        `${jobIdentity(jobInfo)} lattice-clock-sweep: re-indexing ${urls.length} expired card(s) in ${realmURL}`,
      );
    }
    reportStatus(jobInfo, 'finish');
    return { enqueued };
  };
