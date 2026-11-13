// The automation command: the one host command an automation run executes
// (ADR 025 §1.3). A `run-command` job that names it runs one attempt of one
// automation run. The worker takes the run through its row, reads the script,
// mints the run's token and hands the script to a prerender tab on the
// automation's run affinity, where the command runs it on Realm Runner's
// automation surface. The worker then commits the run's overlay, or records
// why the run failed, and finishes the run.
//
// This module holds what the worker and the tab agree on: the command's name,
// what the job carries, what the tab is given, and what it answers.

import type * as JSONTypes from 'json-typescript';

import { MAX_RUN_SECONDS } from './automation-declaration.ts';

// The command a run executes, as the command runner resolves it. No other
// path may run it: `prepareRunCommand` refuses it, so it runs only with a
// run's token, in a tab that holds nothing else.
export const AUTOMATION_COMMAND =
  '@cardstack/boxel-host/tools/run-automation/default';

export function isAutomationCommand(command: string): boolean {
  return command.trim() === AUTOMATION_COMMAND;
}

// The `dedupeKey` of a run's job: `automation:<id>:<trigger>:<slot>`, the
// three a run row is unique by. The worker runs a job that names the
// automation command only when its key is its run's, so a `run-command` job
// that some other publisher enqueued (a bot command, a webhook receiver)
// can't start a run by naming its id.
export function automationRunDedupeKey(run: {
  automationId: string;
  trigger: string;
  slot: string;
}): string {
  return `automation:${run.automationId}:${run.trigger}:${run.slot}`;
}

// The longest script a run takes, in characters: the interactive surface's
// limit. The script rides the request to the prerender server and the tab's
// storage, so it is bounded before it is sent.
export const MAX_AUTOMATION_SCRIPT_CHARS = 100_000;

// What starts a run, besides its trigger label: the kind of a run started by
// hand or by a batch, which no trigger on the card names.
export type AutomationRunTriggerKind =
  | 'cron'
  | 'once'
  | 'webhook'
  | 'manual'
  | 'batch';

// What a run's `run-command` job carries as its `commandInput`.
export interface AutomationJobInput {
  // The run's `automation_runs` id. The row names the automation, its realm,
  // the trigger and slot, and the identity the run acts as.
  runId: string;
  // When the trigger was due, or when a person asked for the run (ISO 8601).
  scheduledAt: string;
  // A Preview: the run stages its writes and is never committed.
  dryRun: boolean;
  // Set for a run no trigger on the card names: one started by hand
  // (Preview, Run now) or by a batch. Otherwise the kind is the trigger's.
  triggerKind?: 'manual' | 'batch';
  // The delivery's JSON body, for a run a webhook started.
  webhookPayload?: JSONTypes.Value;
}

export function isAutomationJobInput(
  value: unknown,
): value is AutomationJobInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  let input = value as Record<string, unknown>;
  return (
    typeof input.runId === 'string' &&
    input.runId.length > 0 &&
    typeof input.scheduledAt === 'string' &&
    !Number.isNaN(Date.parse(input.scheduledAt)) &&
    typeof input.dryRun === 'boolean' &&
    (input.triggerKind === undefined ||
      input.triggerKind === 'manual' ||
      input.triggerKind === 'batch')
  );
}

// What the tab is given: the command's input, as the `json` of the
// `JsonCard` it takes. The run's token is not in it: the tab holds the token
// as its session for the automation's realm.
export interface AutomationScriptInput extends JSONTypes.Object {
  code: string;
  // The URL the automation's realm is served at, ending in a slash.
  realmURL: string;
  // `realm.current.automation`, as the script sees it.
  automation: {
    url: string;
    trigger: { label?: string; kind: AutomationRunTriggerKind };
    scheduledAt: string;
    lastSuccessAt?: string;
    params: Record<string, string>;
    webhookPayload?: JSONTypes.Value;
    dryRun: boolean;
  };
  // What's left of the run's time limit when the worker sends the script.
  secondsCap: number;
  // When the run's time limit passes, as an ISO date. The script runs no
  // later than this, so time spent waiting for the tab counts against it,
  // and the run's token expires at the same moment.
  endsAt: string;
}

export function isAutomationScriptInput(
  value: unknown,
): value is AutomationScriptInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  let input = value as Record<string, unknown>;
  let automation = input.automation as Record<string, unknown> | undefined;
  let trigger = automation?.trigger as Record<string, unknown> | undefined;
  return (
    typeof input.code === 'string' &&
    typeof input.realmURL === 'string' &&
    typeof input.secondsCap === 'number' &&
    input.secondsCap > 0 &&
    typeof input.endsAt === 'string' &&
    !Number.isNaN(Date.parse(input.endsAt)) &&
    !!automation &&
    typeof automation === 'object' &&
    typeof automation.url === 'string' &&
    typeof automation.scheduledAt === 'string' &&
    typeof automation.dryRun === 'boolean' &&
    !!automation.params &&
    typeof automation.params === 'object' &&
    !!trigger &&
    typeof trigger.kind === 'string'
  );
}

// What the tab answers, as the `json` of the `JsonCard` the command returns.
// A run whose script throws or runs out of time answers `error`; the command
// itself fails only when it couldn't run the script at all.
export type AutomationScriptOutcome =
  | { state: 'complete' }
  | {
      state: 'error';
      reason: AutomationScriptErrorReason;
      // Redacted: it never carries the run's token or a credential.
      message: string;
      // The script's own line, when the error came from the script.
      line?: number;
    };

// `script-error`: the script threw an error of its own or didn't compile.
// `timed-out`: the run reached its time limit.
// `run-failed`: a realm call whose error the script didn't catch, or the
// runner itself, failed the run.
export type AutomationScriptErrorReason =
  | 'script-error'
  | 'timed-out'
  | 'run-failed';

export function isAutomationScriptOutcome(
  value: unknown,
): value is AutomationScriptOutcome {
  if (!value || typeof value !== 'object') {
    return false;
  }
  let outcome = value as Record<string, unknown>;
  if (outcome.state === 'complete') {
    return true;
  }
  return (
    outcome.state === 'error' &&
    (outcome.reason === 'script-error' ||
      outcome.reason === 'timed-out' ||
      outcome.reason === 'run-failed') &&
    typeof outcome.message === 'string' &&
    (outcome.line === undefined || typeof outcome.line === 'number')
  );
}

// Time the tab is given past the script's own time limit, to send what the
// script staged through `cards.update` and flush its progress before it
// answers. Every layer that carries the command allows for it, even for a
// run at `MAX_RUN_SECONDS`.
export const AUTOMATION_TAB_GRACE_MS = 30_000;

// How long past its time limit a run's job may go before the queue gives up
// on it: the worker's own steps around the script (starting the run, reading
// the declaration and the script, waiting for a tab) and the commit after it.
export const AUTOMATION_JOB_OVERHEAD_SEC = 120;

// The queue timeout of a run's job: the run's time limit, from the
// automation's `seconds` cap held to `MAX_RUN_SECONDS`, plus the overhead.
// It takes the place of `run-command`'s 60-second default for automation
// runs only.
export function automationJobTimeoutSec(secondsCap: number): number {
  if (!Number.isFinite(secondsCap) || secondsCap <= 0) {
    throw new Error(
      `An automation run's seconds cap must be more than 0, not ${secondsCap}`,
    );
  }
  return (
    Math.ceil(Math.min(secondsCap, MAX_RUN_SECONDS)) +
    AUTOMATION_JOB_OVERHEAD_SEC
  );
}
