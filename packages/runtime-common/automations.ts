// The automation row: one `automations` row per switched-on automation, and
// the functions that change it. The automation's card is its definition; the
// row is who pays for it and where it is (ADR 028 §1.3). Only the functions
// here set the payer, so writing the card can't make someone else pay.
//
//   switch on ──▶ active ──pause──▶ paused ──resume──▶ active
//                 (done)                            (done)
//
// Switch-on and resume start the automation *done* instead of active when
// every trigger is already spent. Remove deletes the row in any state. A
// run's admission moves an automation between active and *waiting for
// credits* on its payer's balance (`setAutomationWaitingForCredits`), and the
// card's index hook (`syncAutomationWithCard`) between active and *done* as
// its triggers are spent or added. The index
// hook also removes the row when the card is deleted or no longer adopts from
// the catalog `Automation` type, and archiving the realm pauses it
// (`pauseRealmAutomations`).
//
// A direct writer of the automation's realm switches an automation on,
// pauses, resumes or removes it. That is asked with `isDirectWriterLocked`
// inside the change's transaction, so a change to the person's permission row
// waits for the change to commit. Whoever switches it on or resumes it becomes its
// payer, and their caps are snapshotted. Two changes pause it without a
// person asking: a card edit that raises a cap above the snapshot or turns on
// `batchedAI` (`checkAutomationCaps`), and the payer no longer being a direct
// writer (`checkAutomationPayer`). Archiving the automation's realm pauses it
// too, and so does a streak of its own runs failing
// (`pauseAfterRepeatedFailures`). Each ends only through a resume, which makes
// its caller the payer, takes a new snapshot and starts the failure streak
// afresh.
//
// Pausing and removing cancel the automation's pending run, so nothing it
// queued starts once it stops, and its running run, which the realm server
// refuses from its next call and its tab stops (unless the run already
// claimed its commit). A person cancels one run, leaving the automation as it
// is, with `cancelAutomationRunFor`.
//
// The tick, the card's index hook and the run task own `next_run`,
// `trigger_runs`, *waiting for credits*, *done* and the `last_*` columns once
// an automation is on. These functions set the next run and *done* only where
// they start a schedule: at switch-on and resume.
//
// Every change here tells its caller's `AutomationReporters`, once it has
// committed, of each run it canceled and of each automation it switched on,
// paused, resumed or removed, or moved between active and *done*. Those
// become the `job` and `automation` realm events a realm's direct writers
// receive.

import {
  AUTOMATION_CAP_NAMES,
  MANUAL_RUN_TRIGGER,
  readAutomationDeclaration,
  type AutomationCaps,
  type AutomationDeclaration,
  type AutomationIndexEntry,
  type AutomationTriggerDeclaration,
} from './automation-declaration.ts';
import {
  reportAutomationChanges,
  type ChangedAutomation,
  type ReportAutomationChange,
} from './automation-change-events.ts';
import {
  reportRunChanges,
  type ReportRunChange,
} from './automation-run-events.ts';
import {
  cancelAutomationRunIn,
  cancelUnfinishedAutomationRuns,
  getAutomationRun,
  logAutomationRunEnded,
  type AutomationRun,
} from './automation-runs.ts';
import {
  computeAutomationSchedule,
  type AutomationSchedule,
  type TriggerRunState,
} from './automation-schedule.ts';
import type { DBAdapter } from './db.ts';
import { isDirectWriterLocked } from './db-queries/realm-permission-queries.ts';
import {
  dbAdapterQuerier,
  param,
  query,
  type Expression,
  type Querier,
} from './expression.ts';
import type { PgPrimitive } from './index.ts';
import { RealmPaths } from './paths.ts';
import type {
  RealmIdentifier,
  RealmResourceIdentifier,
} from './realm-identifiers.ts';
import type { VirtualNetwork } from './virtual-network.ts';

export type AutomationState =
  | 'active'
  | 'paused'
  | 'waiting-for-credits'
  | 'done';

// Why an automation is paused:
//
// - `requested`: a direct writer paused it (`paused_by` names them).
// - `payer-lost-access`: its payer is no longer a direct writer of its realm,
//   their sessions were revoked, or their account can't sign in.
// - `caps-raised`: its card raised a cap above the snapshot.
// - `batched-ai-enabled`: its card turned on `batchedAI`, which the snapshot
//   had off.
// - `realm-archived`: its realm was archived.
// - `repeated-failures`: its own runs failed `AUTOMATION_FAILURES_BEFORE_PAUSE`
//   times in a row (see `pauseAfterRepeatedFailures`).
export type AutomationPauseReason =
  | 'requested'
  | 'payer-lost-access'
  | 'caps-raised'
  | 'batched-ai-enabled'
  | 'realm-archived'
  | 'repeated-failures';

// How many of an automation's own runs fail in a row before it pauses itself
// with `repeated-failures`, unless the caller of `pauseAfterRepeatedFailures`
// passes another number.
export const AUTOMATION_FAILURES_BEFORE_PAUSE = 5;

// The error reasons of runs that admission refused for the payer's spending:
// their balance is short, a credit cap is reached, or the worker has no
// prices. The automation waits for credits instead, and runs again once the
// payer can pay. Admission refuses with exactly these codes.
export const SPENDING_REFUSAL_REASONS = [
  'insufficient-credits',
  'daily-credit-cap-reached',
  'monthly-credit-cap-reached',
  'pricing-unavailable',
] as const;
export type SpendingRefusalReason = (typeof SPENDING_REFUSAL_REASONS)[number];

// The error reasons of runs the platform failed, rather than the automation:
// the worker couldn't ask Matrix or the realm whether the run may start, the
// run's tab or its runner failed or never answered, the commit couldn't be
// sent or its outcome is unknown, the run's job was lost, or its job and row
// disagreed. A Matrix, prerender or worker outage fails every automation's
// runs this way, and counting them would pause every automation that runs
// during it, each waiting on a person to resume it.
export const PLATFORM_FAILURE_REASONS = [
  'account-unverifiable',
  'run-admission-failed',
  'run-failed',
  'commit-failed',
  'commit-interrupted',
  'job-lost',
  'dry-run-mismatch',
] as const;

// Failed runs that neither extend nor break a failure streak.
const UNCOUNTED_FAILURE_REASONS: readonly string[] = [
  ...SPENDING_REFUSAL_REASONS,
  ...PLATFORM_FAILURE_REASONS,
];

// The caps the payer agreed to pay for when they switched the automation on
// or resumed it, and whether it used batched AI then.
export type AutomationCapsSnapshot = AutomationCaps & { batchedAI: boolean };

// A trigger's run state as the row keeps it: what the schedule reads, plus
// what the index hook compares to tell when a trigger starts afresh and its
// cursor must move up to the edit:
// - `timing`: the trigger's timing when the row last followed the card (see
//   `triggerTiming`). A change is an edit to when it fires.
// - `live`: whether the card had the trigger, unspent, when the row last
//   followed it. A trigger that comes back (re-added, or a spent one given a
//   higher `count` or a later `until`) starts at the edit, so the slots it
//   missed while gone don't collapse into a make-up run.
export interface AutomationTriggerRuns extends TriggerRunState {
  timing?: string;
  live?: boolean;
}

// The card's committed index row as the index hook reads it.
// `failureWithheld` marks a row whose latest visit failed and that still
// carries what an earlier visit recorded (see `IndexedInstanceSource`).
export type AutomationCardSource = AutomationIndexEntry & {
  failureWithheld?: boolean;
};

// The result of the automation's most recent run.
export type AutomationRunResult = 'complete' | 'error' | 'canceled';

export interface AutomationRow {
  automationId: RealmResourceIdentifier;
  realm: RealmIdentifier;
  // The Matrix user id of the direct writer who pays for the automation's
  // scheduled runs.
  payer: string;
  state: AutomationState;
  // Set exactly when `state` is `paused`.
  pauseReason: AutomationPauseReason | null;
  // Who paused it, when a person did.
  pausedBy: string | null;
  capsSnapshot: AutomationCapsSnapshot;
  // Each trigger's run state, keyed by its label, in the shape
  // `computeAutomationSchedule` reads as `runState`, with each trigger's
  // timing as the row last saw it.
  triggerRuns: Record<string, AutomationTriggerRuns>;
  // Unix seconds: when the automation was switched on or last resumed. No
  // slot at or before it is due; it is the schedule's `since`.
  scheduledSince: number;
  // Unix seconds: the earliest next run across unspent cron and one-time
  // triggers, or null when none is left.
  nextRun: number | null;
  lastEnqueuedAt: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastResult: AutomationRunResult | null;
  switchedOnAt: string;
  updatedAt: string;
}

// Who is told of what a change did, once it has committed: each run it
// canceled (`reportRunChange`), and each automation whose row it switched on,
// paused, resumed, removed, or moved between active, waiting for credits and
// done (`reportAutomationChange`).
export interface AutomationReporters {
  reportRunChange?: ReportRunChange;
  reportAutomationChange?: ReportAutomationChange;
}

// What every change made in a person's name needs: the paired homeserver,
// whose bot accounts are never direct writers, and a way to turn the
// automation's realm into the served URL its permission rows are keyed by.
export interface AutomationActorOptions extends AutomationReporters {
  matrixServerName: string;
  virtualNetwork: Pick<VirtualNetwork, 'toURL' | 'toURLHref'>;
  // Unix seconds; the current time when absent. Where a schedule starts, its
  // `since` and the next run are computed from this.
  now?: number;
}

// A change was refused:
//
// - `not-a-direct-writer`: the caller isn't a direct writer of the realm.
// - `missing`: no automation with this id is switched on.
// - `outside-realm`: switch-on named a realm the automation isn't in.
// - `other-card`: the declaration given is another card's.
// - `already-switched-on`: switch-on found the automation on already.
// - `not-paused`: resume found an automation that isn't paused.
// - `not-pausable`: pause found an automation that is already paused.
export type AutomationRefusal =
  | {
      ok: false;
      reason:
        | 'not-a-direct-writer'
        | 'missing'
        | 'outside-realm'
        | 'other-card';
    }
  | {
      ok: false;
      reason: 'already-switched-on' | 'not-paused' | 'not-pausable';
      automation: AutomationRow;
    };

export type AutomationChange =
  | { ok: true; automation: AutomationRow }
  | AutomationRefusal;

export async function getAutomation(
  dbAdapter: DBAdapter,
  automationId: RealmResourceIdentifier,
): Promise<AutomationRow | undefined> {
  let row = await selectAutomation(dbAdapterQuerier(dbAdapter), automationId);
  return row ? automationFromRow(row) : undefined;
}

// Switches an automation on for `user`, who becomes its payer, with a snapshot
// of the caps `declaration` sets. Its schedule starts now: the next run is the
// first slot after now, and an automation whose triggers are all spent
// already starts *done*.
//
// `realm` must contain the automation, and `declaration` must be its card:
// the row's realm is the one every later direct-writer check asks about, so a
// writer of one realm can't take on another realm's automation.
export async function switchOnAutomation(
  dbAdapter: DBAdapter,
  {
    automationId,
    realm,
    user,
    declaration,
  }: {
    automationId: RealmResourceIdentifier;
    realm: RealmIdentifier;
    user: string;
    declaration: AutomationDeclaration;
  },
  options: AutomationActorOptions,
): Promise<AutomationChange> {
  if (!new RealmPaths(realm, options.virtualNetwork).inRealm(automationId)) {
    return { ok: false, reason: 'outside-realm' };
  }
  if (!isDeclarationOf(declaration, automationId, options)) {
    return { ok: false, reason: 'other-card' };
  }
  let now = options.now ?? currentUnixSeconds();
  let schedule = startSchedule(declaration, now, {});
  return await withChanges(dbAdapter, options, async (txQuery, changes) => {
    if (!(await isDirectWriterOf(txQuery, realm, user, options))) {
      return { ok: false, reason: 'not-a-direct-writer' };
    }
    let [inserted] = await txQuery([
      'INSERT INTO automations (automation_id, realm, payer, state, caps_snapshot, trigger_runs, scheduled_since, next_run) VALUES (',
      param(automationId),
      ',',
      param(realm),
      ',',
      param(user),
      ',',
      param(schedule.state),
      ',',
      param(JSON.stringify(snapshotCaps(declaration))),
      '::jsonb,',
      param(JSON.stringify(schedule.triggerRuns)),
      '::jsonb,',
      param(unixSecondsToISO(now)),
      '::timestamptz,',
      param(schedule.nextRun),
      '::timestamptz) ON CONFLICT (automation_id) DO NOTHING RETURNING *',
    ]);
    if (inserted) {
      let automation = automationFromRow(inserted);
      changes.automations.push(automation);
      return { ok: true, automation };
    }
    let existing = await selectAutomation(txQuery, automationId);
    if (!existing) {
      // Removed between the insert and the read: there is nothing to report
      // as switched on, and a retry inserts.
      return { ok: false, reason: 'missing' };
    }
    return {
      ok: false,
      reason: 'already-switched-on',
      automation: automationFromRow(existing),
    };
  });
}

// Pauses an automation for `user`, a direct writer of its realm, and cancels
// its pending run and its running one (see `cancelUnfinishedAutomationRuns`).
// An automation that is paused already keeps the reason it has.
export async function pauseAutomation(
  dbAdapter: DBAdapter,
  {
    automationId,
    user,
  }: { automationId: RealmResourceIdentifier; user: string },
  options: AutomationActorOptions,
): Promise<AutomationChange> {
  return await withChanges(dbAdapter, options, async (txQuery, changes) => {
    let found = await lockForDirectWriter(txQuery, automationId, user, options);
    if (!found.ok) {
      return found;
    }
    if (found.automation.state === 'paused') {
      return {
        ok: false,
        reason: 'not-pausable',
        automation: found.automation,
      };
    }
    return {
      ok: true,
      automation: await pause(
        txQuery,
        changes,
        automationId,
        'requested',
        user,
      ),
    };
  });
}

// Resumes a paused automation for `user`, a direct writer of its realm, who
// becomes its payer, with a new snapshot of the caps `declaration` (read from
// the card now) sets. Its schedule starts again now, so the slots that passed
// while it was paused don't run. Each trigger keeps its run count. Its
// failure streak starts afresh: runs created before the resume no longer
// count toward a pause for repeated failures.
export async function resumeAutomation(
  dbAdapter: DBAdapter,
  {
    automationId,
    user,
    declaration,
  }: {
    automationId: RealmResourceIdentifier;
    user: string;
    declaration: AutomationDeclaration;
  },
  options: AutomationActorOptions,
): Promise<AutomationChange> {
  if (!isDeclarationOf(declaration, automationId, options)) {
    return { ok: false, reason: 'other-card' };
  }
  let now = options.now ?? currentUnixSeconds();
  return await withChanges(dbAdapter, options, async (txQuery, changes) => {
    let found = await lockForDirectWriter(txQuery, automationId, user, options);
    if (!found.ok) {
      return found;
    }
    if (found.automation.state !== 'paused') {
      return { ok: false, reason: 'not-paused', automation: found.automation };
    }
    let schedule = startSchedule(
      declaration,
      now,
      found.automation.triggerRuns,
    );
    let [row] = await txQuery([
      'UPDATE automations SET payer =',
      param(user),
      ', state =',
      param(schedule.state),
      ', pause_reason = NULL, paused_by = NULL, caps_snapshot =',
      param(JSON.stringify(snapshotCaps(declaration))),
      '::jsonb, trigger_runs =',
      param(JSON.stringify(schedule.triggerRuns)),
      '::jsonb, scheduled_since =',
      param(unixSecondsToISO(now)),
      '::timestamptz, next_run =',
      param(schedule.nextRun),
      '::timestamptz, failures_since = now(), updated_at = now() WHERE automation_id =',
      param(automationId),
      'RETURNING *',
    ]);
    let automation = automationFromRow(row);
    changes.automations.push(automation);
    return { ok: true, automation };
  });
}

// Removes an automation for `user`, a direct writer of its realm: deletes its
// row and cancels its pending run and its running one (see
// `cancelUnfinishedAutomationRuns`). Its card and script stay. It returns the
// row as it was.
export async function removeAutomation(
  dbAdapter: DBAdapter,
  {
    automationId,
    user,
  }: { automationId: RealmResourceIdentifier; user: string },
  options: AutomationActorOptions,
): Promise<AutomationChange> {
  return await withChanges(dbAdapter, options, async (txQuery, changes) => {
    let found = await lockForDirectWriter(txQuery, automationId, user, options);
    if (!found.ok) {
      return found;
    }
    changes.canceled.push(
      ...(await cancelUnfinishedAutomationRuns(txQuery, automationId, {
        canceledBy: user,
      })),
    );
    await txQuery([
      'DELETE FROM automations WHERE automation_id =',
      param(automationId),
    ]);
    changes.automations.push(found.automation);
    return { ok: true, automation: found.automation };
  });
}

// A person's cancel of a run was refused:
//
// - `missing`: no such run.
// - `not-a-direct-writer`: the caller isn't a direct writer of the run's
//   realm.
// - `not-cancelable`: the run already ended, or its commit was claimed, so
//   its writes may already be landing.
export type AutomationRunCancel =
  | { ok: true; run: AutomationRun }
  | { ok: false; reason: 'missing' | 'not-a-direct-writer' }
  | { ok: false; reason: 'not-cancelable'; run: AutomationRun };

// Cancels a pending or running run for `user`, a direct writer of the run's
// realm, who the run then names in `canceled_by`. A pending run never starts.
// A running run's overlay is discarded, so a cancel before the commit writes
// nothing; the realm server refuses the run's next call, and the run's tab
// stops its script once the realm answers that the run is not running. The
// automation's own state doesn't change: its next run comes due as
// scheduled. A run whose commit was claimed is refused (`not-cancelable`)
// and finishes as its commit does.
export async function cancelAutomationRunFor(
  dbAdapter: DBAdapter,
  { runId, user }: { runId: string; user: string },
  options: Omit<AutomationActorOptions, 'now'>,
): Promise<AutomationRunCancel> {
  let seen = await getAutomationRun(dbAdapter, runId);
  if (!seen) {
    return { ok: false, reason: 'missing' };
  }
  let { realm } = seen;
  let result: AutomationRunCancel = await dbAdapter.withTransaction(
    async (txQuery): Promise<AutomationRunCancel> => {
      // The person's permission row is locked before the run's row, as every
      // change to an automation takes them.
      if (!(await isDirectWriterOf(txQuery, realm, user, options))) {
        return { ok: false, reason: 'not-a-direct-writer' };
      }
      let run = await cancelAutomationRunIn(txQuery, runId, user);
      return run ? { ok: true, run } : { ok: false, reason: 'missing' };
    },
  );
  if (result.ok) {
    await logAutomationRunEnded(dbAdapter, result.run);
    await options.reportRunChange?.(result.run.id);
    return result;
  }
  if (result.reason === 'not-a-direct-writer') {
    return result;
  }
  // The cancel found the run ended or its commit claimed; answer with the
  // run as it stands now.
  let run = await getAutomationRun(dbAdapter, runId);
  return run
    ? { ok: false, reason: 'not-cancelable', run }
    : { ok: false, reason: 'missing' };
}

// Whether the card's caps and `batchedAI` ask for more than the snapshot the
// payer agreed to, and so the reason to pause, or undefined when they don't.
// A cap is raised when the card sets it higher than the snapshot, or leaves
// unset (no limit) a credit cap the snapshot set. A cap the snapshot doesn't
// limit (an unset credit cap, or a cap the card type gained after the
// snapshot was taken) can't be raised.
export function capsRaisedAbove(
  snapshot: AutomationCapsSnapshot,
  card: Pick<AutomationDeclaration, 'caps' | 'batchedAI'>,
):
  | Extract<AutomationPauseReason, 'caps-raised' | 'batched-ai-enabled'>
  | undefined {
  for (let name of AUTOMATION_CAP_NAMES) {
    let agreed = snapshot[name];
    if (typeof agreed !== 'number') {
      continue;
    }
    let asked = card.caps[name];
    if (typeof asked !== 'number' || asked > agreed) {
      return 'caps-raised';
    }
  }
  if (card.batchedAI && !snapshot.batchedAI) {
    return 'batched-ai-enabled';
  }
  return undefined;
}

// Checks the automation's card, as just indexed, against its caps snapshot,
// and pauses it when the card asks for more (`capsRaisedAbove`). An
// automation already paused keeps the reason it has: a resume takes a new
// snapshot whatever paused it. Returns the row, or undefined when the
// automation isn't switched on.
export async function checkAutomationCaps(
  dbAdapter: DBAdapter,
  automationId: RealmResourceIdentifier,
  card: Pick<AutomationDeclaration, 'caps' | 'batchedAI'>,
  reporters: AutomationReporters = {},
): Promise<AutomationRow | undefined> {
  return await withChanges(dbAdapter, reporters, async (txQuery, changes) => {
    let row = await selectAutomation(txQuery, automationId, { lock: true });
    if (!row) {
      return undefined;
    }
    let automation = automationFromRow(row);
    if (automation.state === 'paused') {
      return automation;
    }
    let reason = capsRaisedAbove(automation.capsSnapshot, card);
    if (!reason) {
      return automation;
    }
    return await pause(txQuery, changes, automationId, reason);
  });
}

// Checks that the automation's payer is still a direct writer of its realm,
// and pauses it with `payer-lost-access` when they aren't. An automation
// already paused keeps the reason it has. Returns the row, or undefined when
// the automation isn't switched on.
export async function checkAutomationPayer(
  dbAdapter: DBAdapter,
  automationId: RealmResourceIdentifier,
  options: Omit<AutomationActorOptions, 'now'>,
): Promise<AutomationRow | undefined> {
  return await withChanges(dbAdapter, options, async (txQuery, changes) => {
    let seen = await selectAutomation(txQuery, automationId);
    if (!seen) {
      return undefined;
    }
    let { realm, payer } = automationFromRow(seen);
    // The payer's permission row is locked before the automation's row, the
    // order every change here takes them in.
    let stillWriter = await isDirectWriterOf(txQuery, realm, payer, options);
    let row = await selectAutomation(txQuery, automationId, { lock: true });
    if (!row) {
      return undefined;
    }
    let automation = automationFromRow(row);
    // A resume meanwhile made someone else the payer, and checked them.
    if (
      stillWriter ||
      automation.state === 'paused' ||
      automation.payer !== payer
    ) {
      return automation;
    }
    return await pause(txQuery, changes, automationId, 'payer-lost-access');
  });
}

// Pauses the automation with `payer-lost-access` when `payer` is still its
// payer: the payer's sessions were revoked or their account can't sign in,
// which a run's admission learns and this module can't see. An automation
// already paused keeps the reason it has, and one a resume gave another payer
// is left alone. Returns the row, or undefined when the automation isn't
// switched on.
export async function pauseForPayerLostAccess(
  dbAdapter: DBAdapter,
  automationId: RealmResourceIdentifier,
  payer: string,
  reporters: AutomationReporters = {},
): Promise<AutomationRow | undefined> {
  return await withChanges(dbAdapter, reporters, async (txQuery, changes) => {
    let row = await selectAutomation(txQuery, automationId, { lock: true });
    if (!row) {
      return undefined;
    }
    let automation = automationFromRow(row);
    if (automation.state === 'paused' || automation.payer !== payer) {
      return automation;
    }
    return await pause(txQuery, changes, automationId, 'payer-lost-access');
  });
}

// The failed run a failure streak ends on: the latest one.
export interface AutomationFailure {
  runId: string;
  // The run's error code (such as `script-error`) and its detail.
  reason: string | null;
  message: string | null;
  finishedAt: string;
}

// An automation's current failure streak: how many of its own runs have
// failed since its last complete one, and the latest of them.
export interface AutomationFailures {
  inARow: number;
  last: AutomationFailure | null;
}

// Reads the automation's failure streak from its runs. Only the automation's
// own runs count: those its triggers started (a scheduled slot, a webhook
// delivery, a batch follow-up), never a Preview or a Run now, which a person
// starts as themselves whether or not the automation is on. Of those, only
// runs created at or after the row's `failures_since` count, which switch-on
// and resume set, so a resume clears the streak. A complete run ends the
// streak. A canceled run, a run admission refused for the payer's spending
// (`SPENDING_REFUSAL_REASONS`) and a run the platform failed
// (`PLATFORM_FAILURE_REASONS`) neither break nor extend it. Runs
// are ordered by when they finished, so a commit that lands after its run
// was recorded as an error, which makes the run complete, ends the streak
// too.
export async function readAutomationFailures(
  querier: Querier,
  automationId: RealmResourceIdentifier,
): Promise<AutomationFailures> {
  let since: Expression = [
    '(SELECT failures_since FROM automations WHERE automation_id =',
    param(automationId),
    ')',
  ];
  // A run created at or after `failures_since` also finished after it, so
  // the bound on `finished_at` changes nothing but lets the scans read only
  // the runs since then from `automation_runs_last_finished_idx`.
  let own: Expression = [
    'automation_id =',
    param(automationId),
    'AND finished_at >=',
    ...since,
    'AND created_at >=',
    ...since,
    'AND NOT dry_run AND trigger <>',
    param(MANUAL_RUN_TRIGGER),
    "AND state IN ('complete', 'error')",
    "AND NOT (state = 'error' AND COALESCE(error_reason, '') IN (",
    ...UNCOUNTED_FAILURE_REASONS.flatMap((reason, i) => [
      ...(i ? [','] : []),
      param(reason),
    ]),
    '))',
  ];
  let rows = await querier([
    'SELECT id, error_reason, error_message, finished_at FROM automation_runs WHERE',
    ...own,
    "AND state = 'error' AND finished_at > COALESCE((SELECT max(finished_at) FROM automation_runs WHERE",
    ...own,
    "AND state = 'complete'), '-infinity'::timestamptz)",
    'ORDER BY finished_at DESC, id DESC',
  ]);
  let [latest] = rows;
  return {
    inARow: rows.length,
    last: latest
      ? {
          runId: String(latest.id),
          reason: (latest.error_reason as string | null) ?? null,
          message: (latest.error_message as string | null) ?? null,
          finishedAt: iso(latest.finished_at)!,
        }
      : null,
  };
}

// Pauses the automation with `repeated-failures` once `failuresBeforePause`
// of its own runs have failed in a row (see `readAutomationFailures`), which
// cancels its pending run as every pause does; `reporters` hear about the
// paused automation and each canceled run once the pause commits. The streak is read from the
// runs, so calling this again, or for a run that didn't fail, changes
// nothing, and a call a crash skipped is made up by the next failed run's.
// Only an active automation, or one waiting for credits, pauses: one already
// paused keeps the reason it has, and one *done* has no runs left to stop.
// Returns the row and whether this call paused it, or undefined when the
// automation isn't switched on.
export async function pauseAfterRepeatedFailures(
  dbAdapter: DBAdapter,
  automationId: RealmResourceIdentifier,
  {
    failuresBeforePause = AUTOMATION_FAILURES_BEFORE_PAUSE,
  }: { failuresBeforePause?: number } = {},
  reporters: AutomationReporters = {},
): Promise<{ automation: AutomationRow; paused: boolean } | undefined> {
  if (!Number.isSafeInteger(failuresBeforePause) || failuresBeforePause < 1) {
    throw new Error(
      `an automation pauses after a whole number of failed runs, 1 or more, not ${failuresBeforePause}`,
    );
  }
  return await withChanges(dbAdapter, reporters, async (txQuery, changes) => {
    let row = await selectAutomation(txQuery, automationId, { lock: true });
    if (!row) {
      return undefined;
    }
    let automation = automationFromRow(row);
    if (
      automation.state !== 'active' &&
      automation.state !== 'waiting-for-credits'
    ) {
      return { automation, paused: false };
    }
    let failures = await readAutomationFailures(txQuery, automationId);
    if (failures.inARow < failuresBeforePause) {
      return { automation, paused: false };
    }
    return {
      automation: await pause(
        txQuery,
        changes,
        automationId,
        'repeated-failures',
      ),
      paused: true,
    };
  });
}

// Moves an active automation to *waiting for credits* (`waiting: true`), or a
// waiting one back to active (`waiting: false`), when `payer` is still its
// payer. A run's admission makes both moves: a run of the payer's that the
// balance check refuses, and the next one it admits. An automation that is
// paused or *done*, or whose payer a resume changed, is left alone, so neither
// move can undo a pause or a schedule that has ended. It is one conditional
// UPDATE, so a pause or a *done* that commits first wins, and the move then
// changes nothing. Returns the row as it is after the change, or undefined
// when nothing moved.
export async function setAutomationWaitingForCredits(
  dbAdapter: DBAdapter,
  automationId: RealmResourceIdentifier,
  { payer, waiting }: { payer: string; waiting: boolean },
): Promise<AutomationRow | undefined> {
  let [from, to]: AutomationState[] = waiting
    ? ['active', 'waiting-for-credits']
    : ['waiting-for-credits', 'active'];
  let [row] = await query(dbAdapter, [
    'UPDATE automations SET state =',
    param(to),
    ', updated_at = now() WHERE automation_id =',
    param(automationId),
    'AND state =',
    param(from),
    'AND payer =',
    param(payer),
    'RETURNING *',
  ]);
  return row ? automationFromRow(row) : undefined;
}

// What the index hook did with an automation's row:
//
// - `removed`: the card is deleted (`card-deleted`), or no longer adopts from
//   the catalog `Automation` type (`not-an-automation`), so the row is gone
//   and its pending and running runs are canceled.
// - `paused`: the card raised a cap or turned on `batchedAI`.
// - `recomputed`: the next run, *done* and the trigger cursors follow the
//   card as indexed.
// - `unchanged`: the row stays as it was. It is paused, or the card failed to
//   index or doesn't read as a declaration, so there is nothing to schedule
//   from until a later index reads it.
export type AutomationSync =
  | {
      kind: 'removed';
      reason: 'card-deleted' | 'not-an-automation';
      automation: AutomationRow;
    }
  | {
      kind: 'paused' | 'recomputed' | 'unchanged';
      automation: AutomationRow;
    };

export interface AutomationSyncOptions extends AutomationReporters {
  // `automationRef` as `internalKeyFor` spells it in the realm the index
  // reads, as `readAutomationDeclaration` takes it.
  automationTypeKey: string;
  virtualNetwork: Pick<VirtualNetwork, 'toURL' | 'toURLHref'>;
  // Unix seconds; the current time when absent.
  now?: number;
}

// Brings a switched-on automation's row in step with its card as just
// indexed. `readCard` reads the card's committed index row, or undefined when
// the index holds no live instance there (the card was deleted). It is called
// once the automation's row is locked, so of two index passes over the card
// that sync at once, the later one reads the card no older than the earlier
// one did, and the row ends on the newest card. Returns what it did, or
// undefined when the automation isn't switched on.
//
// The next run is recomputed from the card's triggers and the row's
// per-trigger run counts, which are keyed by label, so an edit keeps each
// trigger's count. A trigger whose timing changed, that is new, or that
// comes back after being removed or spent has its cursor moved up to now, so
// a slot that passed before the edit never comes due. An automation whose triggers are all spent becomes *done*, and a *done*
// one with a trigger left becomes active again. Like `checkAutomationCaps`, a
// card that asks for more than the caps snapshot pauses the automation, and a
// paused one keeps its reason and its schedule until a resume restarts it.
export async function syncAutomationWithCard(
  dbAdapter: DBAdapter,
  automationId: RealmResourceIdentifier,
  readCard: () => Promise<AutomationCardSource | undefined>,
  options: AutomationSyncOptions,
): Promise<AutomationSync | undefined> {
  let now = options.now ?? currentUnixSeconds();
  return await withChanges(dbAdapter, options, async (txQuery, changes) => {
    let row = await selectAutomation(txQuery, automationId, { lock: true });
    if (!row) {
      return undefined;
    }
    let automation = automationFromRow(row);
    let card = await readCard();
    if (!card) {
      return await removeForCard(txQuery, changes, automation, 'card-deleted');
    }
    // A card that failed to index carries no document to read, or carries
    // only what an earlier visit recorded. Its row keeps the schedule it had:
    // an error is no reason to stop the automation, and the run reads the
    // card again when it starts.
    if (!card.instance || card.failureWithheld) {
      return { kind: 'unchanged', automation };
    }
    let read = readAutomationDeclaration(
      {
        url: automationId,
        realmURL: card.realmURL,
        types: card.types,
        instance: card.instance,
      },
      options,
    );
    if (!read.ok) {
      if (read.problems.some(({ code }) => code === 'not-an-automation')) {
        return await removeForCard(
          txQuery,
          changes,
          automation,
          'not-an-automation',
        );
      }
      return { kind: 'unchanged', automation };
    }
    let { declaration } = read;
    if (automation.state === 'paused') {
      return { kind: 'unchanged', automation };
    }
    let reason = capsRaisedAbove(automation.capsSnapshot, declaration);
    if (reason) {
      return {
        kind: 'paused',
        automation: await pause(txQuery, changes, automationId, reason),
      };
    }
    let cursors = withEditCursors(
      automation.triggerRuns,
      declaration.triggers,
      now,
    );
    let schedule = computeAutomationSchedule({
      triggers: declaration.triggers,
      since: automation.scheduledSince,
      now,
      runState: cursors,
    });
    let triggerRuns = recordTriggers(cursors, declaration.triggers, schedule);
    let state: AutomationState = schedule.done
      ? 'done'
      : automation.state === 'done'
        ? 'active'
        : automation.state;
    let [updated] = await txQuery([
      'UPDATE automations SET state =',
      param(state),
      ', trigger_runs =',
      param(JSON.stringify(triggerRuns)),
      '::jsonb, next_run =',
      param(
        schedule.nextRun === undefined
          ? null
          : unixSecondsToISO(schedule.nextRun),
      ),
      '::timestamptz, updated_at = now() WHERE automation_id =',
      param(automationId),
      'RETURNING *',
    ]);
    let recomputed = automationFromRow(updated);
    if (recomputed.state !== automation.state) {
      changes.automations.push(recomputed);
    }
    return { kind: 'recomputed', automation: recomputed };
  });
}

// Every switched-on automation in `realm`, as the index hook looks them up
// after a pass over the realm.
export async function automationsInRealm(
  dbAdapter: DBAdapter,
  realm: RealmIdentifier,
): Promise<AutomationRow[]> {
  let rows = await dbAdapterQuerier(dbAdapter)([
    'SELECT * FROM automations WHERE realm =',
    param(realm),
    'ORDER BY automation_id',
  ]);
  return rows.map(automationFromRow);
}

// Pauses every automation in `realm` that isn't paused already, with
// `realm-archived`, and cancels their pending and running runs, as archiving the realm
// does. One already paused keeps its reason: a resume ends any pause. Returns
// the automations it paused.
export async function pauseRealmAutomations(
  dbAdapter: DBAdapter,
  realm: RealmIdentifier,
  reporters: AutomationReporters = {},
): Promise<AutomationRow[]> {
  return await withChanges(dbAdapter, reporters, async (txQuery, changes) => {
    let rows = await txQuery([
      'SELECT automation_id FROM automations WHERE realm =',
      param(realm),
      "AND state <> 'paused' ORDER BY automation_id FOR UPDATE",
    ]);
    let paused: AutomationRow[] = [];
    for (let row of rows) {
      paused.push(
        await pause(
          txQuery,
          changes,
          row.automation_id as RealmResourceIdentifier,
          'realm-archived',
        ),
      );
    }
    return paused;
  });
}

// Deletes the row of an automation whose card is gone or is no longer an
// automation, and cancels its pending and running runs with that reason.
async function removeForCard(
  txQuery: Querier,
  changes: AutomationChanges,
  automation: AutomationRow,
  reason: 'card-deleted' | 'not-an-automation',
): Promise<AutomationSync> {
  changes.canceled.push(
    ...(await cancelUnfinishedAutomationRuns(txQuery, automation.automationId, {
      reason,
    })),
  );
  await txQuery([
    'DELETE FROM automations WHERE automation_id =',
    param(automation.automationId),
  ]);
  changes.automations.push(automation);
  return { kind: 'removed', reason, automation };
}

// The fields that decide when a trigger fires, as one string to compare:
// its kind, and its expression, time zone, `at` and `until`. `count` isn't
// timing; it is compared with the trigger's run count as it stands.
function triggerTiming(trigger: AutomationTriggerDeclaration): string {
  switch (trigger.kind) {
    case 'cron':
      return JSON.stringify([
        'cron',
        trigger.expression,
        trigger.timeZone,
        trigger.until ?? null,
      ]);
    case 'once':
      return JSON.stringify(['once', trigger.at]);
    case 'webhook':
      return JSON.stringify(['webhook']);
  }
}

// Moves each trigger's cursor up to `editedAt` when the trigger starts
// afresh: it has no run state yet, its timing differs from the one recorded,
// or it wasn't live (removed from the card, or spent) when the row last
// followed the card. A run state that predates those records starts nothing
// afresh. Run states of labels the card no longer has are kept, so a label
// that comes back keeps its count.
export function withEditCursors(
  triggerRuns: Record<string, AutomationTriggerRuns>,
  triggers: AutomationTriggerDeclaration[],
  editedAt: number,
): Record<string, AutomationTriggerRuns> {
  let next: Record<string, AutomationTriggerRuns> = { ...triggerRuns };
  for (let trigger of triggers) {
    let current = next[trigger.label];
    let afresh =
      !current ||
      current.live === false ||
      (current.timing !== undefined &&
        current.timing !== triggerTiming(trigger));
    if (afresh) {
      next[trigger.label] = { ...(current ?? { runs: 0 }), since: editedAt };
    }
  }
  return next;
}

// Records, on each run state, the trigger's timing and whether it is live
// under `schedule`. A label the card no longer has is recorded as not live.
export function recordTriggers(
  triggerRuns: Record<string, AutomationTriggerRuns>,
  triggers: AutomationTriggerDeclaration[],
  schedule: AutomationSchedule,
): Record<string, AutomationTriggerRuns> {
  let spent = new Map(schedule.triggers.map((t) => [t.label, t.spent]));
  let next: Record<string, AutomationTriggerRuns> = {};
  for (let [label, state] of Object.entries(triggerRuns)) {
    next[label] = { ...state, live: false };
  }
  for (let trigger of triggers) {
    next[trigger.label] = {
      ...(next[trigger.label] ?? { runs: 0 }),
      timing: triggerTiming(trigger),
      live: !spent.get(trigger.label),
    };
  }
  return next;
}

// Pauses the row and cancels its pending and running runs. A run a person's
// pause cancels names them in `canceled_by`; one any other pause cancels
// names no one, and carries the pause's reason in `error_reason`.
async function pause(
  txQuery: Querier,
  changes: AutomationChanges,
  automationId: RealmResourceIdentifier,
  reason: AutomationPauseReason,
  pausedBy?: string,
): Promise<AutomationRow> {
  let [row] = await txQuery([
    "UPDATE automations SET state = 'paused', pause_reason =",
    param(reason),
    ', paused_by =',
    param(pausedBy ?? null),
    ', updated_at = now() WHERE automation_id =',
    param(automationId),
    'RETURNING *',
  ]);
  changes.canceled.push(
    ...(await cancelUnfinishedAutomationRuns(
      txQuery,
      automationId,
      pausedBy ? { canceledBy: pausedBy } : { reason },
    )),
  );
  let paused = automationFromRow(row);
  changes.automations.push(paused);
  return paused;
}

// What a change did, for its reporters: the runs it canceled and the
// automations whose rows it changed.
interface AutomationChanges {
  canceled: AutomationRun[];
  automations: ChangedAutomation[];
}

// Runs a change to automations in one transaction, collecting the runs it
// cancels and the automations it changes in `changes`, and writes each
// canceled run's last log line once the transaction has committed: a log line
// locks its run's row, which the transaction holds until then. Each canceled
// run is then reported to `reportRunChange`, and each changed automation to
// `reportAutomationChange`. A transaction the database rolls back and retries
// starts its collection afresh, so only the attempt that committed is logged
// and reported.
async function withChanges<T>(
  dbAdapter: DBAdapter,
  { reportRunChange, reportAutomationChange }: AutomationReporters,
  change: (txQuery: Querier, changes: AutomationChanges) => Promise<T>,
): Promise<T> {
  let changes: AutomationChanges = { canceled: [], automations: [] };
  let result = await dbAdapter.withTransaction((txQuery) => {
    changes = { canceled: [], automations: [] };
    return change(txQuery, changes);
  });
  for (let run of changes.canceled) {
    await logAutomationRunEnded(dbAdapter, run);
  }
  await reportRunChanges(reportRunChange, changes.canceled);
  await reportAutomationChanges(reportAutomationChange, changes.automations);
  return result;
}

// Locks the automation's row for a change `user` asks for, once it is found
// and `user` is a direct writer of its realm. The permission row is locked
// first and the automation's row second, the order switch-on takes them in,
// so two changes never wait on each other's locks. The unlocked read only
// finds the realm, which an automation's id decides: switch-on refuses a
// realm that doesn't contain it.
async function lockForDirectWriter(
  txQuery: Querier,
  automationId: RealmResourceIdentifier,
  user: string,
  options: AutomationActorOptions,
): Promise<
  | { ok: true; automation: AutomationRow }
  | { ok: false; reason: 'not-a-direct-writer' | 'missing' }
> {
  let seen = await selectAutomation(txQuery, automationId);
  if (!seen) {
    return { ok: false, reason: 'missing' };
  }
  let { realm } = automationFromRow(seen);
  if (!(await isDirectWriterOf(txQuery, realm, user, options))) {
    return { ok: false, reason: 'not-a-direct-writer' };
  }
  let row = await selectAutomation(txQuery, automationId, { lock: true });
  if (!row) {
    return { ok: false, reason: 'missing' };
  }
  return { ok: true, automation: automationFromRow(row) };
}

// Whether `declaration` was read from the automation's own card. The two may
// be spelled in different forms, so both are compared as served URLs.
export function isDeclarationOf(
  declaration: AutomationDeclaration,
  automationId: RealmResourceIdentifier,
  { virtualNetwork }: Pick<AutomationActorOptions, 'virtualNetwork'>,
): boolean {
  try {
    return (
      virtualNetwork.toURLHref(declaration.url) ===
      virtualNetwork.toURLHref(automationId)
    );
  } catch {
    return false;
  }
}

export async function isDirectWriterOf(
  txQuery: Querier,
  realm: RealmIdentifier,
  user: string,
  {
    matrixServerName,
    virtualNetwork,
  }: Pick<AutomationActorOptions, 'matrixServerName' | 'virtualNetwork'>,
): Promise<boolean> {
  return await isDirectWriterLocked(
    txQuery,
    virtualNetwork.toURL(realm),
    user,
    matrixServerName,
  );
}

async function selectAutomation(
  txQuery: Querier,
  automationId: RealmResourceIdentifier,
  { lock = false }: { lock?: boolean } = {},
): Promise<Record<string, PgPrimitive> | undefined> {
  let [row] = await txQuery([
    'SELECT * FROM automations WHERE automation_id =',
    param(automationId),
    ...(lock ? ['FOR UPDATE'] : []),
  ]);
  return row;
}

// The state and next run of a schedule that starts at `now`.
function startSchedule(
  declaration: AutomationDeclaration,
  now: number,
  triggerRuns: Record<string, AutomationTriggerRuns>,
): {
  state: 'active' | 'done';
  nextRun: string | null;
  triggerRuns: Record<string, AutomationTriggerRuns>;
} {
  let schedule = computeAutomationSchedule({
    triggers: declaration.triggers,
    since: now,
    now,
    runState: triggerRuns,
  });
  return {
    triggerRuns: recordTriggers(triggerRuns, declaration.triggers, schedule),
    state: schedule.done ? 'done' : 'active',
    nextRun:
      schedule.nextRun === undefined
        ? null
        : unixSecondsToISO(schedule.nextRun),
  };
}

// The card's caps, keyed by name, and its `batchedAI`. Only the caps the
// declaration names are kept.
function snapshotCaps(
  declaration: Pick<AutomationDeclaration, 'caps' | 'batchedAI'>,
): AutomationCapsSnapshot {
  return {
    ...Object.fromEntries(
      AUTOMATION_CAP_NAMES.map((name) => [name, declaration.caps[name]]),
    ),
    batchedAI: declaration.batchedAI,
  } as AutomationCapsSnapshot;
}

export function automationFromRow(
  row: Record<string, PgPrimitive>,
): AutomationRow {
  return {
    automationId: row.automation_id as RealmResourceIdentifier,
    realm: row.realm as RealmIdentifier,
    payer: String(row.payer),
    state: row.state as AutomationState,
    pauseReason: (row.pause_reason as AutomationPauseReason | null) ?? null,
    pausedBy: (row.paused_by as string | null) ?? null,
    capsSnapshot: json(row.caps_snapshot) as AutomationCapsSnapshot,
    triggerRuns: json(row.trigger_runs) as Record<
      string,
      AutomationTriggerRuns
    >,
    scheduledSince: isoToUnixSeconds(row.scheduled_since)!,
    nextRun: isoToUnixSeconds(row.next_run),
    lastEnqueuedAt: iso(row.last_enqueued_at),
    lastStartedAt: iso(row.last_started_at),
    lastFinishedAt: iso(row.last_finished_at),
    lastResult: (row.last_result as AutomationRunResult | null) ?? null,
    switchedOnAt: iso(row.switched_on_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function json(value: PgPrimitive | undefined): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function iso(value: PgPrimitive | undefined): string | null {
  if (value == null) {
    return null;
  }
  return new Date(value as string).toISOString();
}

function isoToUnixSeconds(value: PgPrimitive | undefined): number | null {
  if (value == null) {
    return null;
  }
  return Math.floor(new Date(value as string).getTime() / 1000);
}

function unixSecondsToISO(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
