import { service } from '@ember/service';

import {
  ensureTrailingSlash,
  isAutomationScriptInput,
  type AIBatchFollowUpRead,
  type AutomationScriptOutcome,
} from '@cardstack/runtime-common';
import { presentsAsRunToken } from '@cardstack/runtime-common/run-token';

import HostBaseTool from '../lib/host-base-tool';
import {
  AutomationRunStoppedError,
  AutomationTimeLimitError,
  isPlatformFailure,
  redactSecrets,
} from '../lib/realm-runner/automation';
import {
  resolve as resolveJSON,
  resolveChat,
  type ProxySend,
} from '../lib/realm-runner/research';
import { RunLogSink } from '../lib/realm-runner/run-log-sink';
import { RunStateWatch } from '../lib/realm-runner/run-state-watch';
import { RealmCallFailure, RealmScriptError } from '../lib/realm-runner/runner';
import { claimsFromRawToken } from '../services/realm';

import RunRealmCodeTool, {
  runAutomationScript,
  type AutomationRealmIO,
  type SubmitResolveBatch,
} from './run-realm-code';

import type NetworkService from '../services/network';
import type RealmService from '../services/realm';
import type * as BaseToolModule from '@cardstack/base/command';

// How long before the run's time limit its last progress stops being waited
// on, leaving the worker's commit its round trip before the run's token
// expires.
export const FINAL_FLUSH_MARGIN_MS = 5000;

// The automation command (ADR 025 §1.3): runs one automation run's script on
// Realm Runner's automation surface, in a prerender tab on the run's own
// affinity. The worker gives it the script and `realm.current.automation`;
// the tab holds the run's token as its session for the automation's realm,
// and every call the script makes carries it.
//
// It answers the run's outcome as the `json` of a `JsonCard`: `complete`, or
// `error` with why and, for the script's own error, its line. A realm call's
// error that ends the script is `call-failed`, unless the platform failed a
// request the tab made while the script ran (see `watchedScriptOutcome`).
// The worker commits the overlay or records the error. A script that throws is an
// outcome, not a failure of the command: the command fails only when it
// can't run the script at all.
export default class RunAutomationTool extends HostBaseTool<
  typeof BaseToolModule.JsonCard,
  typeof BaseToolModule.JsonCard
> {
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;

  static actionVerb = 'Run';
  description =
    "Run one automation run's Realm Runner script on the automation surface";

  async getInputType() {
    let commandModule = await this.loadToolModule();
    return commandModule.JsonCard;
  }

  requireInputFields = ['json'];

  protected async run(
    input: BaseToolModule.JsonCard,
  ): Promise<BaseToolModule.JsonCard> {
    let scriptInput: unknown = input.json;
    if (!isAutomationScriptInput(scriptInput)) {
      throw new Error('The automation command needs a script to run');
    }
    let realmURL = ensureTrailingSlash(scriptInput.realmURL);
    // Only an automation run's tab holds a run token, and a run's tab holds
    // nothing else, so this command never runs with a person's sessions.
    let runToken = this.realm.token(realmURL);
    if (!runToken || !presentsAsRunToken(runToken)) {
      throw new Error(
        `The automation command runs only with a run token for ${realmURL}`,
      );
    }
    let secrets = [runToken];
    let { run } = claimsFromRawToken(runToken) as { run?: { id?: unknown } };
    let runId = typeof run?.id === 'string' ? run.id : 'unknown';
    let endsAt = Date.parse(scriptInput.endsAt);
    // The run's console lines, progress and the error it ends with go to its
    // run log, sent with the run's token through the same network as the
    // run's other realm calls. A batch the log refuses or can't take is
    // reported in the tab's console, which the prerender server logs, named
    // by its run.
    let progress = new RunLogSink({
      realmURL,
      runToken,
      fetch: this.network.fetch,
      onError: (message) =>
        console.warn(`[automation run ${runId}] ${message}`),
    });
    let runner = new RunRealmCodeTool(this.toolContext);
    let send = this.runTokenSend(runToken);
    let io: AutomationRealmIO = {
      ...runner.automationRealmIO(realmURL),
      resolve: (request, signal) => resolveJSON(request, send, signal),
      resolveChat: (body, signal) => resolveChat(body, send, signal),
      resolveBatch: this.runTokenBatchSubmit(runToken),
      readBatchFollowUp: this.runTokenBatchFollowUp(runToken),
    };

    // The run's time limit counts from its start, so the time it waited for
    // this tab comes off what the script gets.
    let secondsCap = Math.min(
      scriptInput.secondsCap,
      (endsAt - Date.now()) / 1000,
    );
    let outcome: AutomationScriptOutcome;
    if (secondsCap <= 0) {
      outcome = {
        state: 'error',
        reason: 'timed-out',
        message:
          'The automation run reached its time limit before its script could start',
      };
    } else {
      // A run canceled, paused or taken over while its script runs is
      // refused at its next call; this stops the script in this tab too,
      // whether or not it makes another call.
      let watch = new RunStateWatch({
        realmURL,
        runToken,
        fetch: this.network.fetch,
      });
      watch.start();
      try {
        outcome = await watchedScriptOutcome(
          this.network,
          () =>
            runAutomationScript({
              code: scriptInput.code,
              realmURL,
              automation: scriptInput.automation,
              secondsCap,
              batchDeadlineMinutes: scriptInput.batchDeadlineMinutes,
              batchedAI: scriptInput.batchedAI === true,
              ...(typeof scriptInput.followUpBatchId === 'string'
                ? { followUpBatchId: scriptInput.followUpBatchId }
                : {}),
              io,
              progress,
              secrets,
              signal: watch.signal,
            }),
          secrets,
        );
      } finally {
        watch.stop();
      }
    }
    // The run's progress is sent before the run answers, while the run is
    // still running: the run log takes lines only from a running run, and
    // the worker finishes the run once it has the answer. The wait ends short
    // of the run's time limit, so a slow log never costs the run its commit;
    // a line sent past the limit would be refused with the expired token
    // anyway.
    await flushBefore(progress, endsAt - FINAL_FLUSH_MARGIN_MS);

    let commandModule = await this.loadToolModule();
    return new commandModule.JsonCard({ json: outcome });
  }

  // `realm.resolve`'s model call carries the run's token to the realm
  // server's request forwarding, which counts it against the run's `resolve`
  // cap, prices it against its `aiCredits` cap and bills it to the run's
  // identity. The token names the realm server that minted it.
  private runTokenSend(runToken: string): ProxySend {
    let forwardURL = `${realmServerOf(runToken)}_request-forward`;
    return async ({ url, requestBody, signal }) => {
      let response = await this.network.fetch(forwardURL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${runToken}`,
        },
        body: JSON.stringify({
          url,
          method: 'POST',
          requestBody,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
        }),
        signal,
      });
      if (!response.ok) {
        let errorText = await response.text();
        throw new Error(
          `Request forward failed: ${response.status} - ${errorText}`,
        );
      }
      return response;
    };
  }

  // `realm.resolve.batch`'s submit carries the run's token to the realm
  // server's batch path, which refuses it unless the automation turns on
  // batched AI, counts each request against the run's `resolve` cap,
  // reserves the batch on its `aiCredits` cap and records it for its
  // follow-up run and its bill. A refusal comes back as the call's error,
  // with the server's reason.
  private runTokenBatchSubmit(runToken: string): SubmitResolveBatch {
    let batchesURL = `${realmServerOf(runToken)}_ai-batches`;
    return async (submit, signal) => {
      let response = await this.network.fetch(batchesURL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${runToken}`,
        },
        body: JSON.stringify(submit),
        signal,
      });
      let text = await response.text();
      if (!response.ok) {
        throw new Error(
          `realm.resolve.batch was refused: ${response.status} - ${batchRefusal(text)}`,
        );
      }
      let id: unknown;
      try {
        id = JSON.parse(text)?.id;
      } catch {
        id = undefined;
      }
      if (typeof id !== 'string' || id.length === 0) {
        throw new Error(
          'realm.resolve.batch: the batch path answered with no batch id',
        );
      }
      return { id };
    };
  }

  // A batch's follow-up reads its batch with the run's token, from the realm
  // server's batch path, which answers only the batch's own follow-up run:
  // the batch's results, or its requests to send at the normal price.
  private runTokenBatchFollowUp(
    runToken: string,
  ): (batchId: string, signal: AbortSignal) => Promise<AIBatchFollowUpRead> {
    let batchesURL = `${realmServerOf(runToken)}_ai-batches`;
    return async (batchId, signal) => {
      let response = await this.network.fetch(
        `${batchesURL}/${encodeURIComponent(batchId)}/follow-up`,
        {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${runToken}`,
          },
          signal,
        },
      );
      let text = await response.text();
      if (!response.ok) {
        throw new Error(
          `The follow-up couldn't read batch ${batchId}: ${response.status} - ${batchRefusal(text)}`,
        );
      }
      let read: AIBatchFollowUpRead;
      try {
        read = JSON.parse(text);
      } catch {
        throw new Error(
          `The follow-up couldn't read batch ${batchId}: the batch path answered with no batch`,
        );
      }
      if (!read || !Array.isArray(read.requests)) {
        throw new Error(
          `The follow-up couldn't read batch ${batchId}: the batch path answered with no requests`,
        );
      }
      return read;
    };
  }
}

// The reason in a refusal from the batch path: its JSON:API `errors`, or the
// body as it came.
function batchRefusal(text: string): string {
  try {
    let errors = JSON.parse(text)?.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      return errors
        .map((error) =>
          typeof error === 'string'
            ? error
            : (error?.detail ?? JSON.stringify(error)),
        )
        .join('; ');
    }
  } catch {
    // not JSON
  }
  return text;
}

// The realm server the run token names, ending in a slash.
function realmServerOf(runToken: string): string {
  let { realmServerURL } = claimsFromRawToken(runToken) as {
    realmServerURL?: string;
  };
  if (!realmServerURL) {
    throw new Error('The run token names no realm server');
  }
  return ensureTrailingSlash(realmServerURL);
}

// Resolves once `progress` has sent what it holds, or at `deadline` (ms since
// the epoch), whichever comes first. The sends carry on after a deadline.
async function flushBefore(
  progress: RunLogSink,
  deadline: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      progress.flush(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// `scriptOutcome` for a run in this tab, with `platformFailed` read from
// every fetch the tab makes while the script runs (`NetworkService.fetch`,
// which the realm calls, the loader's module fetches, `realm.resolve`'s
// request forwarding and the run's own log and state checks all go through).
// One that fails for the platform (`isPlatformFailure`), before its answer
// or while its body is read, makes a realm call's error `run-failed`: the
// call may have failed for the platform's sake. The tab runs one automation
// run at a time, so every fetch it makes while the script runs is the run's.
export async function watchedScriptOutcome(
  network: Pick<NetworkService, 'watchFetches'>,
  run: () => Promise<unknown>,
  secrets: string[],
): Promise<AutomationScriptOutcome> {
  let platformFailed = false;
  let unwatch = network.watchFetches((_url, result) => {
    if (isPlatformFailure(result)) {
      platformFailed = true;
    }
  });
  try {
    return await scriptOutcome(run, secrets, () => platformFailed);
  } finally {
    unwatch();
  }
}

// Runs a script and answers its outcome: `complete`, or the error it ended
// with (redacted with `secrets`), with when it started and ended in this tab
// for the run's telemetry. `platformFailed` says, once the script has ended,
// whether the platform failed a request the run made, which makes a realm
// call's error `run-failed` rather than `call-failed`.
export async function scriptOutcome(
  run: () => Promise<unknown>,
  secrets: string[],
  platformFailed: () => boolean,
): Promise<AutomationScriptOutcome> {
  let startedAt = Date.now();
  let outcome: AutomationScriptOutcome;
  try {
    await run();
    outcome = { state: 'complete' };
  } catch (error) {
    outcome = errorOutcome(error, secrets, platformFailed());
  }
  outcome.timing = { startedAt, endedAt: Date.now() };
  return outcome;
}

function errorOutcome(
  error: unknown,
  secrets: string[],
  platformFailed: boolean,
): AutomationScriptOutcome {
  let message = redactSecrets(
    error instanceof Error ? error.message : String(error),
    secrets,
  );
  if (error instanceof AutomationTimeLimitError) {
    return { state: 'error', reason: 'timed-out', message };
  }
  if (error instanceof AutomationRunStoppedError) {
    return { state: 'error', reason: 'stopped', message };
  }
  if (error instanceof RealmScriptError) {
    let { line } = error.scriptError;
    return {
      state: 'error',
      reason: 'script-error',
      message,
      ...(typeof line === 'number' ? { line } : {}),
    };
  }
  if (error instanceof RealmCallFailure && !platformFailed) {
    return { state: 'error', reason: 'call-failed', message };
  }
  return { state: 'error', reason: 'run-failed', message };
}
