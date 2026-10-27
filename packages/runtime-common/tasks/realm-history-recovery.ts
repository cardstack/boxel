import type * as JSONTypes from 'json-typescript';
import type { Task } from './index.ts';
import { jobIdentity } from '../index.ts';
import {
  registerQueueJobDefinition,
  type QueueCoalesceContext,
  type QueueCoalesceDecision,
} from '../queue.ts';
import { recordingRealmURLs } from '../db-queries/realm-history-state-queries.ts';
import { fetchRealmOwnerUsername } from '../db-queries/realm-permission-queries.ts';

// The cron enqueues this job with no arguments; it visits every realm that
// records history.
type RealmHistoryRecoveryArgs = JSONTypes.Object;

export interface RealmHistoryRecoveryResult extends JSONTypes.Object {
  // Each realm visited, by what its recovery found: `clean`, `recovered`,
  // `read-only`, `leased`, `not-recording`, or `failed` for a realm that could
  // not be asked.
  realms: Record<string, string>;
}

// Each realm's recovery scans every file in it, so a sweep over many realms
// is long; it is the only job in its group, so a long lease delays nothing
// but the next sweep, which coalesces into this one anyway.
export const REALM_HISTORY_RECOVERY_JOB_TIMEOUT_SEC = 30 * 60;

export { realmHistoryRecovery };

// The fixed concurrency group already runs one sweep at a time; this also
// collapses a queued tick into a pending or in-flight sweep, so overlapping
// cron ticks never pile up.
function chooseRealmHistoryRecoveryCoalesceDecision(
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
  jobType: 'realm-history-recovery',
  coalesce: chooseRealmHistoryRecoveryCoalesceDecision,
});

// The scheduled half of realm recovery: for each realm that recorded history
// when last mounted, ask the realm-server serving it to check the realm
// against its history (`POST <realm>/_history-recovery`). Recovery runs there
// rather than here, because only that process holds the realm's files, its
// history and its broadcaster. The request is made as the realm's owner, as
// the realm's other system jobs are. A realm that is already consistent comes
// back `clean`, having written nothing.
const realmHistoryRecovery: Task<
  RealmHistoryRecoveryArgs,
  RealmHistoryRecoveryResult
> = ({ dbAdapter, getAuthedFetch, reportStatus, log }) =>
  async function (args) {
    let { jobInfo } = args;
    reportStatus(jobInfo, 'start');
    let realms: Record<string, string> = {};
    for (let realmURL of await recordingRealmURLs(dbAdapter)) {
      try {
        let realmUsername = await fetchRealmOwnerUsername(dbAdapter, realmURL);
        if (!realmUsername) {
          realms[realmURL] = 'failed';
          log.warn(
            `${jobIdentity(jobInfo)} realm-history-recovery: ${realmURL} has no owner to act as; skipped`,
          );
          continue;
        }
        let fetch = await getAuthedFetch({ realmURL, realmUsername });
        let response = await fetch(`${realmURL}_history-recovery`, {
          method: 'POST',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
          realms[realmURL] = 'failed';
          log.warn(
            `${jobIdentity(jobInfo)} realm-history-recovery: ${realmURL} answered ${response.status}: ${(await response.text()).slice(0, 200)}`,
          );
          continue;
        }
        let body = (await response.json()) as { outcome?: string };
        realms[realmURL] = body.outcome ?? 'failed';
      } catch (err: unknown) {
        realms[realmURL] = 'failed';
        log.warn(
          `${jobIdentity(jobInfo)} realm-history-recovery: could not ask ${realmURL} to recover: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    log.info(
      `${jobIdentity(jobInfo)} realm-history-recovery visited ${Object.keys(realms).length} realm(s): ${JSON.stringify(realms)}`,
    );
    reportStatus(jobInfo, 'finish');
    return { realms };
  };
