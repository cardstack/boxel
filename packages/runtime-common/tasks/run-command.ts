import type * as JSONTypes from 'json-typescript';

import type { Task } from './index';

import {
  fetchRealmPermissions,
  fetchUserPermissions,
  jobIdentity,
  type RunCommandResponse,
  ensureFullMatrixUserId,
  ensureTrailingSlash,
} from '../index';

export interface RunCommandArgs extends JSONTypes.Object {
  realmURL: string;
  realmUsername: string;
  runAs: string;
  command: string;
  commandInput: JSONTypes.Object | null;
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
