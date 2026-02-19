import type * as JSONTypes from 'json-typescript';

import type { Task } from './index';

import {
  type ResolvedCodeRef,
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
  command: ResolvedCodeRef;
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

    let result = await prerenderer.runCommand({
      realm: normalizedRealmURL,
      auth,
      command,
      commandInput: commandInput ?? undefined,
    });

    reportStatus(jobInfo, 'finish');
    return result;
  };
