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

export interface RunCommandArgs extends JSONTypes.Object {
  realmURL: string;
  realmUsername: string;
  runAs: string;
  command: string;
  commandInput: JSONTypes.Object | null;
  // When true, a command that finishes with an error status makes the job
  // throw rather than resolving with the error in-band. The queue then marks
  // the job rejected and reports it to Sentry. Interactive callers (bot-runner,
  // the run-command HTTP endpoint, webhooks) pass false so a command error
  // stays a normal result to hand back to the user. System-initiated jobs
  // (cron syncs) pass true so a persistently failing job is never silent.
  // Required (not optional) so the args object satisfies JSONTypes.Object's
  // JSON-shape index signature, which excludes `undefined`.
  alertOnError: boolean;
}

// No coalesce handler: each run-command enqueue is a distinct invocation
// (different `command`/`runAs`/`commandInput`) whose result is returned to its
// caller. Joining would route one caller's response to another. The realm
// concurrency group already serializes per-realm execution.

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
    let {
      jobInfo,
      realmURL,
      realmUsername,
      runAs,
      command,
      commandInput,
      alertOnError,
    } = args;
    // Turn an error outcome into either a thrown failure (so the queue rejects
    // the job and reports it to Sentry) or an in-band error result, depending
    // on whether the caller asked to be alerted.
    let fail = (message: string): RunCommandResponse => {
      if (alertOnError) {
        throw new Error(message);
      }
      return {
        status: 'error',
        error: message,
      };
    };
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
      return fail(message);
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
      return fail(message);
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

    if (alertOnError && result.status === 'error') {
      let message = `${jobIdentity(jobInfo)} command ${command} failed in ${normalizedRealmURL}: ${result.error ?? 'unknown error'}`;
      log.error(message);
      throw new Error(message);
    }

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
