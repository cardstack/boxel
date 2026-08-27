import type * as JSONTypes from 'json-typescript';

import type { Task } from './index.ts';

import {
  fetchRealmPermissions,
  fetchUserPermissions,
  jobIdentity,
  type RunCommandResponse,
  ensureFullMatrixUserId,
  ensureTrailingSlash,
} from '../index.ts';
import { isEqual } from 'lodash-es';
import {
  registerQueueJobDefinition,
  type QueueCoalesceContext,
  type QueueCoalesceDecision,
} from '../queue.ts';

export interface RunCommandArgs extends JSONTypes.Object {
  realmURL: string;
  realmUsername: string;
  runAs: string;
  command: string;
  commandInput: JSONTypes.Object | null;
  // Opt-in deduplication. A publisher that knows its invocation is
  // idempotent (a scheduled sync, a periodic sweep) sets this so a second
  // identical enqueue joins the pending or running job instead of running
  // the command again. Ordinary run-command jobs pass null: they execute
  // arbitrary commands with side effects, and two identical requests can
  // legitimately mean two executions.
  dedupeKey: string | null;
}

// Coalescing is opt-in via `dedupeKey`. Without a key every enqueue inserts,
// so a command that writes files, creates rooms or sends events is never
// silently collapsed into an earlier request. With a key, a twin is a job of
// the same type carrying the same key and identical args; it produces the
// same result, so the second caller can wait on it. This is what keeps a
// scheduled command that is enqueued from several worker tasks at once (one
// cron tick per task) down to a single run.
function chooseRunCommandCoalesceDecision(
  context: QueueCoalesceContext,
): QueueCoalesceDecision {
  let { incoming, candidates, inFlightCandidates } = context;
  let incomingKey = dedupeKeyOf(incoming.args);
  if (!incomingKey) {
    return { type: 'insert' };
  }
  let isTwin = (candidate: { jobType: string; args: unknown }) =>
    candidate.jobType === incoming.jobType &&
    dedupeKeyOf(candidate.args) === incomingKey &&
    isEqual(candidate.args, incoming.args);
  let twin = candidates.find(isTwin) ?? inFlightCandidates.find(isTwin);
  if (!twin) {
    return { type: 'insert' };
  }
  return { type: 'join', jobId: twin.id };
}

function dedupeKeyOf(args: unknown): string | undefined {
  if (args && typeof args === 'object' && 'dedupeKey' in args) {
    let key = (args as { dedupeKey?: unknown }).dedupeKey;
    return typeof key === 'string' && key.length > 0 ? key : undefined;
  }
  return undefined;
}

registerQueueJobDefinition({
  jobType: 'run-command',
  coalesce: chooseRunCommandCoalesceDecision,
});

export { runCommand };

const runCommand: Task<RunCommandArgs, RunCommandResponse> = ({
  reportStatus,
  log,
  dbAdapter,
  prerenderer,
  createPrerenderAuth,
  matrixURL,
}) =>
  async function (args) {
    let { jobInfo, realmURL, realmUsername, runAs, command, commandInput } =
      args;
    log.debug(
      `${jobIdentity(jobInfo)} starting run-command for job: ${JSON.stringify({
        realmURL,
        realmUsername,
        runAs,
        command,
      })}`,
    );
    reportStatus(jobInfo, 'start');

    let normalizedRealmURL = ensureTrailingSlash(realmURL);
    let realmPermissions = await fetchRealmPermissions(
      dbAdapter,
      new URL(normalizedRealmURL),
    );
    let runAsUserId = ensureFullMatrixUserId(runAs, matrixURL);
    let userPermissions = realmPermissions[runAsUserId];
    if (!userPermissions || userPermissions.length === 0) {
      let message = `${jobIdentity(jobInfo)} ${runAs} does not have permissions in ${normalizedRealmURL}`;
      log.error(message);
      reportStatus(jobInfo, 'finish');
      return {
        status: 'error',
        error: message,
      };
    }

    // Include JWTs for all realms the user has access to
    // Cross-realm card references (e.g. linksToMany to cards in other realms)
    // require auth when the Loader fetches modules.
    let allUserPermissions = await fetchUserPermissions(dbAdapter, {
      userId: runAsUserId,
    });
    allUserPermissions[normalizedRealmURL] = userPermissions;
    let auth = createPrerenderAuth(runAsUserId, allUserPermissions);
    let accessibleRealms = Object.keys(allUserPermissions);

    let normalizedCommand = normalizeCommandSpecifier(
      command,
      normalizedRealmURL,
    );
    if (!normalizedCommand) {
      let message = `${jobIdentity(jobInfo)} invalid command specifier`;
      log.error(message, { command, realmURL: normalizedRealmURL });
      reportStatus(jobInfo, 'finish');
      return {
        status: 'error',
        error: message,
      };
    }

    let augmentedCommandInput = commandInput
      ? { ...commandInput, accessibleRealms }
      : undefined;

    let result = await prerenderer.runCommand({
      userId: runAsUserId,
      auth,
      command: normalizedCommand,
      commandInput: augmentedCommandInput,
      priority: jobInfo?.priority,
    });

    reportStatus(jobInfo, 'finish');
    return result;
  };

function normalizeCommandSpecifier(
  command: string,
  realmURL: string,
): string | undefined {
  let specifier = command.trim();
  if (!specifier) {
    return undefined;
  }

  // Legacy bot command URLs can point at /commands/<name>/<export> on the
  // realm server host. Resolve those to the target realm before prerendering.
  let path = toPathname(specifier);
  if (!path || !path.startsWith('/commands/')) {
    return specifier;
  }

  let [commandName, exportName = 'default'] = path
    .slice('/commands/'.length)
    .split('/');
  if (!commandName) {
    return undefined;
  }
  return `${ensureTrailingSlash(realmURL)}commands/${commandName}/${exportName || 'default'}`;
}

function toPathname(commandSpecifier: string): string | undefined {
  try {
    return new URL(commandSpecifier).pathname;
  } catch {
    return undefined;
  }
}
