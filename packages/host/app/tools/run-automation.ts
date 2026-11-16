import { service } from '@ember/service';

import {
  ensureTrailingSlash,
  isAutomationScriptInput,
  type AutomationScriptOutcome,
} from '@cardstack/runtime-common';
import { presentsAsRunToken } from '@cardstack/runtime-common/run-token';

import HostBaseTool from '../lib/host-base-tool';
import {
  AutomationTimeLimitError,
  redactSecrets,
} from '../lib/realm-runner/automation';
import {
  resolve as resolveJSON,
  type ProxySend,
} from '../lib/realm-runner/research';
import { RunLogSink } from '../lib/realm-runner/run-log-sink';
import { RealmScriptError } from '../lib/realm-runner/runner';
import { claimsFromRawToken } from '../services/realm';

import RunRealmCodeTool, {
  runAutomationScript,
  type AutomationRealmIO,
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
// `error` with why and, for the script's own error, its line. The worker
// commits the overlay or records the error. A script that throws is an
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
      try {
        await runAutomationScript({
          code: scriptInput.code,
          realmURL,
          automation: scriptInput.automation,
          secondsCap,
          io,
          progress,
          secrets,
        });
        outcome = { state: 'complete' };
      } catch (error) {
        outcome = errorOutcome(error, secrets);
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
    let { realmServerURL } = claimsFromRawToken(runToken) as {
      realmServerURL?: string;
    };
    if (!realmServerURL) {
      throw new Error('The run token names no realm server');
    }
    let forwardURL = `${ensureTrailingSlash(realmServerURL)}_request-forward`;
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

function errorOutcome(
  error: unknown,
  secrets: string[],
): AutomationScriptOutcome {
  let message = redactSecrets(
    error instanceof Error ? error.message : String(error),
    secrets,
  );
  if (error instanceof AutomationTimeLimitError) {
    return { state: 'error', reason: 'timed-out', message };
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
  return { state: 'error', reason: 'run-failed', message };
}
