import type * as JSONTypes from 'json-typescript';
import type { Task } from './index.ts';
import { jobIdentity } from '../index.ts';
import {
  registerQueueJobDefinition,
  type QueueCoalesceContext,
  type QueueCoalesceDecision,
} from '../queue.ts';

// The cron enqueues this job with no arguments; it cleans the whole provider.
type OAuthProviderCleanupArgs = JSONTypes.Object;

// What one run deleted from the OAuth provider's tables: short-lived objects
// and tokens by kind, then grants and clients registered by dynamic client
// registration.
export interface OAuthProviderCleanupResult extends JSONTypes.Object {
  objects: Record<string, number>;
  tokens: Record<string, number>;
  grants: number;
  dynamicClients: number;
}

// Deletes the OAuth provider's rows nothing can use any more. The realm
// server's worker supplies it (`realm-server/lib/oauth-provider/cleanup.ts`),
// since the provider's tables are the realm server's.
export type OAuthProviderCleanup = () => Promise<OAuthProviderCleanupResult>;

export { oauthProviderCleanup };

// A tick that finds a run already queued or running joins it: the run that
// is there covers it, since the job has no arguments.
function chooseOAuthProviderCleanupCoalesceDecision(
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
  jobType: 'oauth-provider-cleanup',
  coalesce: chooseOAuthProviderCleanupCoalesceDecision,
});

// The daily cleanup of the OAuth provider's tables. A failure fails the job,
// which reports it to Sentry; the next day's run starts over. A worker
// without the cleanup, such as a test harness's, deletes nothing.
const oauthProviderCleanup: Task<
  OAuthProviderCleanupArgs,
  OAuthProviderCleanupResult
> = ({ oauthProviderCleanup: cleanup, reportStatus, log }) =>
  async function (args) {
    let { jobInfo } = args;
    reportStatus(jobInfo, 'start');
    if (!cleanup) {
      log.debug(
        `${jobIdentity(jobInfo)} oauth-provider cleanup: no cleanup configured; nothing to delete`,
      );
      reportStatus(jobInfo, 'finish');
      return { objects: {}, tokens: {}, grants: 0, dynamicClients: 0 };
    }
    let result = await cleanup();
    log.info(
      `${jobIdentity(jobInfo)} oauth-provider cleanup: deleted ` +
        `objects (${describe(result.objects)}), ` +
        `tokens (${describe(result.tokens)}), ` +
        `${result.grants} grant(s), ` +
        `${result.dynamicClients} dynamic client(s)`,
    );
    reportStatus(jobInfo, 'finish');
    return result;
  };

function describe(counts: Record<string, number>): string {
  let entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  return entries.length > 0
    ? entries.map(([kind, count]) => `${kind} ${count}`).join(', ')
    : 'none';
}
