// The tick: once a minute, start a run for each trigger of a switched-on
// automation that has come due (ADR 028 §1.5).
//
// A system cron enqueues an `automation-tick` job every minute, from every
// worker manager. The job claims each due row (`state` active or *waiting for
// credits*, `next_run` at or before now) with `FOR UPDATE SKIP LOCKED`, so two
// ticks never handle one automation at once, and holds the row until it has
// advanced the row past what it enqueued. A tick that finds the row locked,
// or no longer due, leaves it alone.
//
// For each trigger due at the row's next run, the tick:
//
// - makes the run row (trigger label, slot = the scheduled instant as ISO
//   text, acting as the payer), and enqueues its `run-command` job through
//   `enqueueAutomationRunJob`: `dedupeKey` `automation:<id>:<trigger>:<slot>`,
//   `concurrencyGroup` `automation:<id>`, the automation tier, and a timeout
//   from the card's `seconds` cap. Two triggers due at the same instant start
//   two runs, which the concurrency group runs one after the other.
// - or, when a scheduled run of the automation is pending from an earlier
//   instant, joins it instead. The joined slot is *skipped*: it starts nothing,
//   its trigger's run count stays as it was, and the pending run's log names
//   it. A pending run already covers every slot that comes due while it waits,
//   since a run catches up on everything since its last. Only a run a cron or
//   one-time trigger on the card started is joined: a Preview never commits,
//   and a Run now acts as whoever clicked rather than the payer. A run that has
//   started is never joined; the new run waits behind it.
//
// Either way the trigger's `lastSlot` moves to the slot, so the next
// computation schedules strictly after it. The tick then recomputes the next
// run, and handles any other trigger due by now in turn: after an outage each
// cron trigger owes at most one make-up run (`computeAutomationSchedule` with
// `now`). The row ends with each trigger's run count and cursor, the next
// run, *done* when every trigger is spent, and `last_enqueued_at` when a run
// started.
//
// The run row and the job are written before the automation row is advanced,
// while the tick holds the automation row's lock: the queue publishes in a
// transaction of its own, and a worker must find the run row when it takes
// the job. Both writes are keyed by the automation, trigger and slot, so a
// tick that fails after them and before the advance leaves the slot due, and
// the next tick finds the same run row and joins the same job (or, once that
// job has run, enqueues one that finds the run over and leaves it). Before it
// schedules anything, a tick adopts every pending run a trigger on the card
// started for a slot past that trigger's `lastSlot`: such a run came from a
// tick that stopped before advancing the row. The tick counts it as started,
// moves the trigger's `lastSlot` to its slot and enqueues its job again (the
// queue joins the job still there), so each such run is counted once.
//
// The tick reads the card's declaration from the index, as a run does. It
// follows an edit the card's index hook hasn't applied yet the same way the
// hook does (`withEditCursors`), so a slot that passed before the edit never
// comes due. A card that raises a cap above the snapshot is left for the index
// hook to pause, and a card that doesn't read as a declaration leaves the row
// due and unchanged until it does.

import { ensureTrailingSlash } from './paths.ts';
import type { QueuePublisher } from './queue.ts';
import type { VirtualNetwork } from './virtual-network.ts';
import type { AutomationDeclaration } from './automation-declaration.ts';
import { createAutomationRun } from './automation-runs.ts';
import { logRunPlatformLine } from './automation-run-log.ts';
import { computeAutomationSchedule } from './automation-schedule.ts';
import {
  automationFromRow,
  capsRaisedAbove,
  recordTriggers,
  withEditCursors,
  type AutomationPauseReason,
  type AutomationState,
  type AutomationTriggerRuns,
} from './automations.ts';
import type { DBAdapter } from './db.ts';
import { param, query, type Querier } from './expression.ts';
import { enqueueAutomationRunJob } from './jobs/run-command.ts';
import {
  emitAutomationRunEvent,
  type AutomationRunEnqueuedEvent,
} from './automation-run-telemetry.ts';
import type { RealmResourceIdentifier } from './realm-identifiers.ts';

// How many due rows the tick reads per page. The tick reads pages until none
// is left, so this bounds a query, not a tick.
export const AUTOMATION_TICK_PAGE_SIZE = 100;

// The card's declaration as the index holds it, or why it can't be read.
export type AutomationDeclarationRead =
  | { ok: true; declaration: AutomationDeclaration }
  | { ok: false; message: string };

export interface AutomationTickOptions {
  queue: QueuePublisher;
  // Reads the automation card's declaration from the index
  // (`readRunDeclaration` in the worker).
  readDeclaration: (
    automationId: RealmResourceIdentifier,
  ) => Promise<AutomationDeclarationRead>;
  virtualNetwork: Pick<VirtualNetwork, 'toURLHref'>;
  // Unix seconds; the current time when absent.
  now?: number;
  pageSize?: number;
}

// What the tick did with one due trigger slot.
export type AutomationTickTrigger =
  | {
      kind: 'started';
      trigger: string;
      // The scheduled instant, as the run row's `slot` holds it.
      slot: string;
      runId: string;
      jobId: number;
    }
  | {
      kind: 'skipped';
      trigger: string;
      slot: string;
      // The pending run the slot joined.
      joinedRunId: string;
    };

// What the tick did with one due automation:
//
// - `enqueued`: it handled every trigger due by now (`triggers`), and
//   advanced the row.
// - `not-due`: the card as indexed has nothing due, so the row's next run was
//   recomputed with nothing enqueued.
// - `unreadable`: the card doesn't read as a declaration (`message` says
//   why). The row stays due and unchanged.
// - `caps-raised`: the card asks for more than the caps snapshot. Nothing is
//   enqueued; the index hook pauses the automation.
// - `failed`: handling the automation threw. A run or job the tick wrote
//   before the error is found again by the next tick.
export type AutomationTickOutcome =
  | {
      kind: 'enqueued';
      automationId: RealmResourceIdentifier;
      triggers: AutomationTickTrigger[];
      state: AutomationState;
      nextRun: number | null;
    }
  | {
      kind: 'not-due';
      automationId: RealmResourceIdentifier;
      state: AutomationState;
      nextRun: number | null;
    }
  | {
      kind: 'unreadable';
      automationId: RealmResourceIdentifier;
      message: string;
    }
  | {
      kind: 'caps-raised';
      automationId: RealmResourceIdentifier;
      reason: Extract<
        AutomationPauseReason,
        'caps-raised' | 'batched-ai-enabled'
      >;
    }
  | {
      kind: 'failed';
      automationId: RealmResourceIdentifier;
      error: unknown;
    };

// Handles every automation due at `now`, one transaction each, so one
// automation's failure doesn't stop the rest. An automation another tick holds
// is skipped and doesn't appear in the result.
export async function tickAutomations(
  dbAdapter: DBAdapter,
  options: AutomationTickOptions,
): Promise<AutomationTickOutcome[]> {
  let now = options.now ?? currentUnixSeconds();
  let pageSize = options.pageSize ?? AUTOMATION_TICK_PAGE_SIZE;
  let outcomes: AutomationTickOutcome[] = [];
  let after: string | undefined;
  for (;;) {
    let rows = await query(dbAdapter, [
      'SELECT automation_id FROM automations WHERE',
      ...dueAt(now),
      ...(after ? ['AND automation_id >', param(after)] : []),
      'ORDER BY automation_id LIMIT',
      param(pageSize),
    ]);
    for (let row of rows) {
      let automationId = row.automation_id as RealmResourceIdentifier;
      try {
        let outcome = await tickAutomation(
          dbAdapter,
          automationId,
          now,
          options,
        );
        if (outcome) {
          outcomes.push(outcome);
        }
      } catch (error) {
        outcomes.push({ kind: 'failed', automationId, error });
      }
    }
    if (rows.length < pageSize) {
      return outcomes;
    }
    after = String(rows[rows.length - 1].automation_id);
  }
}

// Claims one automation if it is still due and no other tick holds it, and
// handles its due triggers. Undefined when it isn't claimed.
async function tickAutomation(
  dbAdapter: DBAdapter,
  automationId: RealmResourceIdentifier,
  now: number,
  options: AutomationTickOptions,
): Promise<AutomationTickOutcome | undefined> {
  // The runs' `enqueued` telemetry, written once the transaction that
  // enqueued them has committed.
  let enqueued: AutomationRunEnqueuedEvent[] = [];
  let outcome = await claimAndEnqueue(
    dbAdapter,
    automationId,
    now,
    options,
    enqueued,
  );
  if (outcome?.kind === 'enqueued') {
    for (let event of enqueued) {
      emitAutomationRunEvent(event);
    }
    await logTriggers(dbAdapter, outcome.triggers);
  }
  return outcome;
}

async function claimAndEnqueue(
  dbAdapter: DBAdapter,
  automationId: RealmResourceIdentifier,
  now: number,
  options: AutomationTickOptions,
  enqueued: AutomationRunEnqueuedEvent[],
): Promise<AutomationTickOutcome | undefined> {
  return await dbAdapter.withTransaction(async (txQuery) => {
    let [row] = await txQuery([
      'SELECT * FROM automations WHERE automation_id =',
      param(automationId),
      'AND',
      ...dueAt(now),
      'FOR UPDATE SKIP LOCKED',
    ]);
    if (!row) {
      return undefined;
    }
    let automation = automationFromRow(row);
    let read = await options.readDeclaration(automationId);
    if (!read.ok) {
      return { kind: 'unreadable', automationId, message: read.message };
    }
    let { declaration } = read;
    let raised = capsRaisedAbove(automation.capsSnapshot, declaration);
    if (raised) {
      return { kind: 'caps-raised', automationId, reason: raised };
    }

    let realmURL = ensureTrailingSlash(
      options.virtualNetwork.toURLHref(automation.realm),
    );
    let runState: Record<string, AutomationTriggerRuns> = withEditCursors(
      automation.triggerRuns,
      declaration.triggers,
      now,
    );
    let handled: AutomationTickTrigger[] = [];
    let start = async (label: string, at: number) => {
      let slot = unixSecondsToISO(at);
      let run = await createAutomationRun(dbAdapter, {
        automationId,
        realm: automation.realm,
        trigger: label,
        slot,
        actsAs: automation.payer,
      });
      let job = await enqueueAutomationRunJob(options.queue, {
        automationId,
        realmURL,
        actsAs: run.actsAs,
        trigger: label,
        slot,
        secondsCap: declaration.caps.seconds,
        input: { runId: run.id, scheduledAt: slot, dryRun: false },
      });
      let enqueuedAt = Date.now();
      enqueued.push({
        kind: 'enqueued',
        automation: automationId,
        run: run.id,
        job: job.id,
        realm: automation.realm,
        trigger: label,
        triggerKind:
          declaration.triggers.find((t) => t.label === label)?.kind ?? 'cron',
        dryRun: false,
        scheduledAt: slot,
        enqueuedAt: new Date(enqueuedAt).toISOString(),
        scheduleLagMs: Math.max(0, enqueuedAt - at * 1000),
      });
      let state = runState[label] ?? { runs: 0 };
      runState[label] = { ...state, runs: state.runs + 1, lastSlot: at };
      handled.push({
        kind: 'started',
        trigger: label,
        slot,
        runId: run.id,
        jobId: job.id,
      });
      return run;
    };

    // The pending runs a cron or one-time trigger on the card started, oldest
    // instant first. A run past its trigger's `lastSlot` came from a tick that
    // stopped before advancing the row, and is adopted as started.
    let scheduled = new Set(
      declaration.triggers
        .filter(({ kind }) => kind === 'cron' || kind === 'once')
        .map(({ label }) => label),
    );
    let pending: { id: string; at: number }[] = [];
    for (let run of await pendingRuns(txQuery, automationId)) {
      let at = Date.parse(run.slot) / 1000;
      if (!scheduled.has(run.trigger) || !Number.isFinite(at)) {
        continue;
      }
      let lastSlot = runState[run.trigger]?.lastSlot;
      if (lastSlot === undefined || at > lastSlot) {
        await start(run.trigger, at);
      }
      pending.push({ id: run.id, at });
    }
    pending.sort((a, b) => a.at - b.at);

    let scheduleNow = () =>
      computeAutomationSchedule({
        triggers: declaration.triggers,
        since: automation.scheduledSince,
        now,
        runState,
      });
    let schedule = scheduleNow();
    // Each pass handles every trigger due at the earliest instant and moves
    // their cursors past it, so each trigger is handled at most once per tick
    // and the passes end within one per trigger.
    for (
      let pass = 0;
      schedule.nextRun !== undefined &&
      schedule.nextRun <= now &&
      pass < declaration.triggers.length;
      pass++
    ) {
      let at = schedule.nextRun;
      // The latest pending scheduled run from an earlier instant. A run at
      // the same instant is another trigger's, which starts a run of its own.
      let joinable = pending.filter((run) => run.at < at).pop();
      for (let label of schedule.dueTriggers) {
        if (joinable) {
          let state = runState[label] ?? { runs: 0 };
          runState[label] = { ...state, lastSlot: at };
          handled.push({
            kind: 'skipped',
            trigger: label,
            slot: unixSecondsToISO(at),
            joinedRunId: joinable.id,
          });
        } else {
          let run = await start(label, at);
          pending.push({ id: run.id, at });
        }
      }
      schedule = scheduleNow();
    }

    let state: AutomationState = schedule.done ? 'done' : automation.state;
    let nextRun = schedule.nextRun ?? null;
    let started = handled.some(({ kind }) => kind === 'started');
    await txQuery([
      'UPDATE automations SET state =',
      param(state),
      ', trigger_runs =',
      param(
        JSON.stringify(
          recordTriggers(runState, declaration.triggers, schedule),
        ),
      ),
      '::jsonb, next_run =',
      param(nextRun === null ? null : unixSecondsToISO(nextRun)),
      '::timestamptz,',
      ...(started ? ['last_enqueued_at = now(),'] : []),
      'updated_at = now() WHERE automation_id =',
      param(automationId),
    ]);

    if (handled.length === 0) {
      return { kind: 'not-due', automationId, state, nextRun };
    }
    return {
      kind: 'enqueued',
      automationId,
      triggers: handled,
      state,
      nextRun,
    };
  });
}

// Writes a line on each run the tick started or a slot joined, naming the
// trigger and the slot: the run log is where a person reads what started a
// run and which slots it covers. A line that can't be written is logged and
// dropped (`logRunPlatformLine`).
async function logTriggers(
  dbAdapter: DBAdapter,
  triggers: AutomationTickTrigger[],
): Promise<void> {
  for (let trigger of triggers) {
    await logRunPlatformLine(
      dbAdapter,
      trigger.kind === 'started' ? trigger.runId : trigger.joinedRunId,
      trigger.kind === 'started'
        ? {
            kind: 'trigger',
            level: 'info',
            message: `The ${trigger.trigger} trigger started this run for ${trigger.slot}`,
            data: { trigger: trigger.trigger, slot: trigger.slot },
          }
        : {
            kind: 'trigger',
            level: 'info',
            message: `The ${trigger.trigger} trigger's ${trigger.slot} slot joined this run, which was still pending`,
            data: {
              trigger: trigger.trigger,
              slot: trigger.slot,
              skipped: true,
            },
          },
      trigger.kind === 'started' ? trigger.jobId : undefined,
    );
  }
}

// The automation's pending runs, as this tick found them.
async function pendingRuns(
  txQuery: Querier,
  automationId: RealmResourceIdentifier,
): Promise<{ id: string; trigger: string; slot: string }[]> {
  let rows = await txQuery([
    'SELECT id, trigger, slot FROM automation_runs WHERE automation_id =',
    param(automationId),
    "AND state = 'pending' ORDER BY created_at, id",
  ]);
  return rows.map((row) => ({
    id: String(row.id),
    trigger: String(row.trigger),
    slot: String(row.slot),
  }));
}

// The rows the tick handles at `now`: the ones `automations_due_idx` serves.
function dueAt(now: number) {
  return [
    "state IN ('active', 'waiting-for-credits') AND next_run IS NOT NULL AND next_run <=",
    param(unixSecondsToISO(now)),
    '::timestamptz',
  ];
}

function unixSecondsToISO(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
