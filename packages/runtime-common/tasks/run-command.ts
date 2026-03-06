import type * as JSONTypes from 'json-typescript';

import type { Task } from './index';

import {
  fetchRealmPermissions,
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

    let auth = createPrerenderAuth(runAsUserId, {
      [normalizedRealmURL]: userPermissions,
    });

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

    let result = await prerenderer.runCommand({
      userId: runAsUserId,
      auth,
      command: normalizedCommand,
      commandInput: commandInput ?? undefined,
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
