import type * as JSONTypes from 'json-typescript';

import type { Task } from './index.ts';

import { jobIdentity, type RunCommandResponse } from '../index.ts';
import { prepareRunCommand } from '../run-command-request.ts';
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

// Runs a command from a queue job, for publishers that need the invocation to
// outlive the request that asked for it (a webhook delivery, a cron tick).
//
// A command run this way holds a worker for its whole browser-side duration,
// so it cannot wait on anything that itself needs a worker. That rules out the
// realm's JSON-API card write, which awaits an `incremental-index` job: with
// no other worker free, the write completes only once this job gives up its
// worker, which is after its timeout has already failed it — and that failure
// lands on the job, past any `try`/`catch` the command wrote. A command that
// persists cards belongs on `/_run-command`, which drives the prerenderer from
// the web tier and holds no worker; a queued one can write through
// `/_atomic`, whose writes index deferred.
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

    let outcome = await prepareRunCommand({
      dbAdapter,
      matrixURL,
      createPrerenderAuth,
      realmURL,
      runAs,
      command,
      commandInput,
    });
    if (!outcome.ok) {
      let message = `${jobIdentity(jobInfo)} ${outcome.error}`;
      log.error(message);
      reportStatus(jobInfo, 'finish');
      return {
        status: 'error',
        error: message,
      };
    }

    let result = await prerenderer.runCommand({
      userId: outcome.prepared.userId,
      auth: outcome.prepared.auth,
      command: outcome.prepared.command,
      commandInput: outcome.prepared.commandInput,
      priority: jobInfo?.priority,
    });

    reportStatus(jobInfo, 'finish');
    return result;
  };
