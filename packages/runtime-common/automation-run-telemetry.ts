// Telemetry for automation runs: one JSON line per boundary a run crosses,
// on the `boxel:automation-runs` channel, the same convention as the other
// `boxel:*` telemetry channels. The whole line is one JSON object with an
// explicit `channel` and `kind`, its numbers flat top-level fields, so Loki's
// `| json` reads it and LogQL can `unwrap` any duration or count.
//
// Every event carries the run's ids: `automation` (the automation card's id),
// `run` (the `automation_runs` id) and, once the run has one, `job` (the
// `run-command` queue job) and `attempt` (the job's reservation that owns the
// run). Every timestamp is an ISO 8601 string; every duration is in ms.
//
// The boundaries, in the order a run crosses them:
//
// - `enqueued`: a trigger, a click or a batch enqueued the run's job. Its
//   `scheduledAt` is when the run was due and `scheduleLagMs` how late the
//   enqueue was. The tick writes it once its transaction commits; a click
//   writes it only for the run it created, not for a resent click that
//   joined it.
// - `claimed`: a worker claimed the job and took the run (`queueWaitMs`, the
//   lane it was claimed in, its priority).
// - `admitted`: admission let the run go ahead or refused it, and how long the
//   checks took.
// - `script`: the run's tab answered. When the worker asked for the tab and
//   when the tab answered, by the worker's clock; when the script started and
//   ended, by the tab's; how long the prerender server took to give the call
//   a tab, by its own measure; and the tab's memory as the command ended.
// - `commit`: the worker sent the run's batch and the realm answered.
// - `finished`: the run ended, however it ended, with every timestamp and
//   count its row holds; again, as `complete`, if a commit it ended without
//   lands afterwards.
// - `index-pass`: the index passes the run's commit caused have finished,
//   with the usage they measured.
// - `charged`: a charge for the run was written (`run` for its compute and
//   network, `run_indexing` for the indexing its commit caused).
//
// Each `callApi` and `resolve` call and each run milestone is a line of the
// run's log (`automation-run-log.ts`), which reaches Loki tagged with the same
// ids, and milestones also go to `boxel:automation-milestones` with their
// times as the run ends. The prerender server reports its run
// capacity on this channel too (`capacity`), as it samples its pool.
//
// Telemetry never fails the work it describes: a line that can't be built is
// logged and dropped.

import {
  automationRunDedupeKey,
  type AutomationRunTriggerKind,
} from './automation-run-command.ts';
import type { DBAdapter } from './db.ts';
import { param, query } from './expression.ts';
import { logger } from './log.ts';

export const AUTOMATION_RUNS_CHANNEL = 'boxel:automation-runs';

export interface AutomationRunIds {
  // The automation card's id (an RRI).
  automation: string;
  // The `automation_runs` id.
  run: string;
  // The run's `run-command` queue job, once there is one.
  job?: number;
  // The job reservation that owns the run (`automation_runs.attempt`).
  attempt?: number;
}

export interface AutomationRunEnqueuedEvent extends AutomationRunIds {
  kind: 'enqueued';
  realm: string;
  trigger: string;
  triggerKind: AutomationRunTriggerKind;
  dryRun: boolean;
  scheduledAt: string;
  enqueuedAt: string;
  // Enqueue minus the time the run was due. Near zero for a click; for a
  // scheduled run, how late the tick enqueued it.
  scheduleLagMs: number;
}

export interface AutomationRunClaimedEvent extends AutomationRunIds {
  kind: 'claimed';
  claimedAt: string;
  // Enqueue to claim, by the database's clock.
  queueWaitMs?: number;
  // The lane the job was claimed in (its concurrency group) and its priority.
  lane?: string;
  priority: number;
}

export interface AutomationRunAdmittedEvent extends AutomationRunIds {
  kind: 'admitted';
  admitted: boolean;
  // The refusal's code, for a run admission refused.
  reason?: string;
  at: string;
  // From the claim to admission's answer.
  admissionMs: number;
}

export interface AutomationRunScriptEvent extends AutomationRunIds {
  kind: 'script';
  outcome: 'complete' | 'error';
  reason?: string;
  // When the worker asked for a tab and when the tab answered, by the
  // worker's clock.
  tabRequestedAt: string;
  tabAnsweredAt: string;
  // When the script started and ended, by the tab's clock.
  scriptStartedAt?: string;
  scriptEndedAt?: string;
  scriptMs?: number;
  // How long the prerender server took to give the call a tab, from the
  // call's arrival there (its `launchMs`), and how much of that was waiting
  // behind the run affinity's tab and starting a new one. The call's transit
  // between the worker and the server is left out, so the gap between
  // `tabRequestedAt` and the script's start is longer than this.
  tabLaunchMs?: number;
  tabQueueMs?: number;
  tabStartupMs?: number;
  tabReused?: boolean;
  // The tab time added to the run (what its compute charge prices).
  tabMs: number;
  // The prerender request's correlation id, which the prerender server's
  // own lines for the call carry.
  prerenderRequestId?: string;
  // The tab's memory as the script ended.
  tabJsHeapUsedMB?: number;
  tabJsHeapTotalMB?: number;
  tabDomMB?: number;
  tabBuffersMB?: number;
}

export interface AutomationRunCommitEvent extends AutomationRunIds {
  kind: 'commit';
  outcome: 'committed' | 'refused' | 'failed';
  code?: string;
  status?: number;
  commitSentAt: string;
  answeredAt: string;
  ms: number;
  tries: number;
}

// As the run ended. A run that ended as an error while its claimed commit was
// still in flight becomes complete on its row if the batch lands afterwards;
// that writes a second `finished` with `state: "complete"` and
// `lateCommit: true`.
export interface AutomationRunFinishedEvent extends AutomationRunIds {
  kind: 'finished';
  lateCommit?: true;
  realm: string;
  trigger: string;
  dryRun: boolean;
  state: string;
  errorReason?: string;
  canceledBy?: string;
  createdAt: string;
  startedAt?: string;
  admittedAt?: string;
  commitStartedAt?: string;
  committedAt?: string;
  finishedAt?: string;
  // Created to finished, and started to finished.
  totalMs?: number;
  runMs?: number;
  prerenderTabMs: number;
  callApiCalls: number;
  callApiResponseBytes: number;
  resolveCalls: number;
  writes: number;
  aiCreditsSpent: number;
}

export interface AutomationRunIndexPassEvent extends AutomationRunIds {
  kind: 'index-pass';
  realm: string;
  // The index or render job that finished the run's indexing.
  indexJob?: number;
  completedAt: string;
  workerProcessSeconds: number;
  prerenderTabSeconds: number;
}

export interface AutomationRunChargedEvent extends AutomationRunIds {
  kind: 'charged';
  realm: string;
  chargeKind: 'run' | 'run_indexing';
  // What the charge did (`MeteredChargeResult`): `charged`,
  // `already-charged`, `nothing-to-charge`, `no-payer` or `no-prices`.
  result: string;
  at: string;
  // The credits it costs at this process's prices, rounded up as the charge
  // is, when the process has prices.
  credits?: number;
  prerenderTabSeconds?: number;
  workerProcessSeconds?: number;
  downloadedGB?: number;
}

// One prerender server's run capacity, as it samples its pool. A run holds
// one tab of its affinity for the whole script, so `runningRuns` is the runs
// the server is running at once and `queuedRuns` the runs waiting behind them
// for their affinity's tab.
export interface AutomationRunCapacityEvent {
  kind: 'capacity';
  at: string;
  runTabs: number;
  runningRuns: number;
  queuedRuns: number;
  totalTabs: number;
  maxTabs: number;
}

export type AutomationRunEvent =
  | AutomationRunEnqueuedEvent
  | AutomationRunClaimedEvent
  | AutomationRunAdmittedEvent
  | AutomationRunScriptEvent
  | AutomationRunCommitEvent
  | AutomationRunFinishedEvent
  | AutomationRunIndexPassEvent
  | AutomationRunChargedEvent
  | AutomationRunCapacityEvent;

// Test seam: when set, events go to the sink instead of the logger.
let telemetrySink: ((event: AutomationRunEvent) => void) | undefined;

export function setAutomationRunTelemetrySink(
  sink: ((event: AutomationRunEvent) => void) | undefined,
): void {
  telemetrySink = sink;
}

// Created lazily, as the other telemetry channels are: a module-scope
// `logger()` for a channel can race the import that installs the log
// definitions.
let channelLog: ReturnType<typeof logger> | undefined;
let log: ReturnType<typeof logger> | undefined;

// Takes the event, or a function that builds it, so a line that can't be
// built (a timestamp no `Date` can hold, say) costs the line and never the
// work it describes.
export function emitAutomationRunEvent(
  eventOrBuild: AutomationRunEvent | (() => AutomationRunEvent),
): void {
  try {
    let event =
      typeof eventOrBuild === 'function' ? eventOrBuild() : eventOrBuild;
    if (telemetrySink) {
      telemetrySink(event);
      return;
    }
    (channelLog ??= logger(AUTOMATION_RUNS_CHANNEL)).info(
      JSON.stringify({ channel: AUTOMATION_RUNS_CHANNEL, ...event }),
    );
  } catch (error) {
    (log ??= logger('automation-run-telemetry')).warn(
      `could not write a run telemetry event: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// The queue job that owns a run's attempt: the job of the reservation the
// run's row names. Undefined when the run has no attempt, or the lookup
// fails.
export async function jobOfAttempt(
  dbAdapter: DBAdapter,
  attempt: number | null | undefined,
): Promise<number | undefined> {
  if (attempt == null) {
    return undefined;
  }
  try {
    let [row] = await query(dbAdapter, [
      'SELECT job_id FROM job_reservations WHERE id =',
      param(attempt),
    ]);
    return row?.job_id == null ? undefined : Number(row.job_id);
  } catch {
    return undefined;
  }
}

// A run's queue job: the job of its attempt once a worker has claimed it, or,
// for a run no worker claimed (one canceled or abandoned while pending), the
// unclaimed job its key names. Undefined when there is none, or the lookup
// fails.
export async function jobOfRun(
  dbAdapter: DBAdapter,
  run: {
    automationId: string;
    trigger: string;
    slot: string;
    attempt: number | null;
  },
): Promise<number | undefined> {
  if (run.attempt != null) {
    return await jobOfAttempt(dbAdapter, run.attempt);
  }
  try {
    let [row] = await query(dbAdapter, [
      'SELECT id FROM jobs WHERE concurrency_group =',
      param(`automation:${run.automationId}`),
      "AND status = 'unfulfilled' AND args->>'dedupeKey' =",
      param(automationRunDedupeKey(run)),
      'ORDER BY id DESC LIMIT 1',
    ]);
    return row?.id == null ? undefined : Number(row.id);
  } catch {
    return undefined;
  }
}

// A run's ids as its worker log lines carry them, in the run log's tag form,
// so one regex finds a run's lines across both.
export function automationRunLogTag(ids: AutomationRunIds): string {
  return `[automation-run] automation=${ids.automation} run=${ids.run}${ids.job !== undefined ? ` job=${ids.job}` : ''}${ids.attempt !== undefined ? ` attempt=${ids.attempt}` : ''}`;
}

export function msBetween(
  from: string | null | undefined,
  to: string | null | undefined,
): number | undefined {
  if (!from || !to) {
    return undefined;
  }
  let ms = Date.parse(to) - Date.parse(from);
  return Number.isFinite(ms) ? Math.max(0, ms) : undefined;
}
