// The automation row: one `automations` row per switched-on automation, and
// the functions that change it. The automation's card is its definition; the
// row is who pays for it and where it is (ADR 028 §1.3). Only the functions
// here set the payer, so writing the card can't make someone else pay.
//
//   switch on ──▶ active ──pause──▶ paused ──resume──▶ active
//                 (done)                            (done)
//                 (waiting for key approval)        (waiting for key approval)
//
// Switch-on and resume start the automation *done* instead of active when
// every trigger is already spent, and *waiting for key approval* when one of
// its declared operations lacks a key approval that matches it (ADR 039). A
// waiting automation has no next run and runs nothing; once every approval
// matches (`followKeyApprovals`), it moves to the state its schedule gives
// from that moment, so a slot that passed while it waited never runs. An
// approval that stops matching moves an active, *done* or *waiting for
// credits* automation back to waiting at once: the card's index hook finds
// an edit to its version, and a run's admission finds an approval that
// ended (`waitForKeyApproval`). A pause takes precedence over waiting. Remove deletes the row in any state. A
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
// person asking: a card edit that raises a cap above the snapshot, turns on
// `batchedAI` (`checkAutomationCaps`) or names an incoming webhook the
// snapshot doesn't (`webhooksChangedFrom`), and the payer no longer being a direct
// writer (`checkAutomationPayer`). Archiving the automation's realm pauses it
// too, and so does a streak of its own runs failing
// (`pauseAfterRepeatedFailures`). Each ends only through a resume, which makes
// its caller the payer, takes a new snapshot and starts the failure streak
// afresh.
//
// Pausing and removing cancel the automation's pending run, so nothing it
// queued starts once it stops, and its running run, which the realm server
// refuses from its next call and its tab stops (unless the run already
// claimed its commit). A pause holds a batch's follow-up instead, pending or
// running, and so does a wait for a key approval
// (`holdAutomationFollowUpRuns`): the batch is paid for either way, and a
// resume, or the automation going active again, starts the follow-up (ADR 030
// §1.5). Remove drops it with the automation's other runs. A person cancels
// one run, leaving the automation as it is, with `cancelAutomationRunFor`.
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
  type AutomationProblem,
  type AutomationTriggerDeclaration,
} from './automation-declaration.ts';
import type { AdmissionRefusal } from './automation-admission.ts';
import {
  KEY_APPROVAL_REFUSAL_REASONS,
  triggerTiming,
} from './automation-key-approval.ts';
import {
  reportAutomationChanges,
  type ChangedAutomation,
  type ReportAutomationChange,
} from './automation-change-events.ts';
import {
  reportRunChanges,
  type ReportRunChange,
} from './automation-run-events.ts';
import { logRunPlatformLine } from './automation-run-log.ts';
import {
  cancelAutomationRunIn,
  cancelUnfinishedAutomationRuns,
  getAutomationRun,
  holdAutomationFollowUpRuns,
  insertOrFindAutomationRun,
  logAutomationRunEnded,
  type AutomationRun,
} from './automation-runs.ts';
import {
  computeAutomationSchedule,
  type AutomationSchedule,
  type TriggerRunState,
} from './automation-schedule.ts';
import {
  declaredWebhookPaths,
  unusableWebhookProblems,
} from './automation-webhooks.ts';
import type { DBAdapter } from './db.ts';
import {
  isDirectWriter,
  isDirectWriterLocked,
} from './db-queries/realm-permission-queries.ts';
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
  | 'waiting-for-key-approval'
  | 'done';

// Why an automation is paused:
//
// - `requested`: a direct writer paused it (`paused_by` names them).
// - `payer-lost-access`: its payer is no longer a direct writer of its realm,
//   their sessions were revoked, or their account can't sign in.
// - `caps-raised`: its card raised a cap above the snapshot.
// - `batched-ai-enabled`: its card turned on `batchedAI`, which the snapshot
//   had off.
// - `webhook-changed`: its card names an incoming webhook the snapshot
//   doesn't, either a trigger pointed at another webhook or a new webhook
//   trigger. Deliveries to that webhook would start runs the payer pays for.
// - `webhook-owner-lost-access`: a delivery arrived at a webhook one of its
//   triggers names, and the person who made that webhook is no longer a
//   direct writer of its realm (see `takeWebhookDelivery`). The realm can't
//   use the webhook, so the delivery starts no run.
// - `realm-archived`: its realm was archived.
// - `repeated-failures`: its own runs failed `AUTOMATION_FAILURES_BEFORE_PAUSE`
//   times in a row (see `pauseAfterRepeatedFailures`).
// - `invalid-declaration`: a run came due while its card didn't read as a
//   declaration, such as a cron trigger that fires more often than the
//   minimum allows (see `pauseForInvalidDeclaration`). The row's
//   `pauseProblems` names what the declaration reader found. Unlike the other
//   reasons, the index hook lifts this one once the card reads again.
export type AutomationPauseReason =
  | 'requested'
  | 'payer-lost-access'
  | 'caps-raised'
  | 'batched-ai-enabled'
  | 'webhook-changed'
  | 'webhook-owner-lost-access'
  | 'realm-archived'
  | 'repeated-failures'
  | 'invalid-declaration';

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
// run's tab or its runner failed or never answered, a realm call failed while
// the platform was failing the run's requests, the commit couldn't be sent or
// its outcome is unknown, the run's job was lost, or its job and row
// disagreed. A Matrix, prerender, realm or worker outage fails every
// automation's runs this way, and counting them would pause every automation
// that runs during it, each waiting on a person to resume it. A realm call
// that fails on its own terms ends its run as `call-failed`, which counts.
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
  ...KEY_APPROVAL_REFUSAL_REASONS,
];

// The caps the payer agreed to pay for when they switched the automation on
// or resumed it, whether it used batched AI then, and the incoming webhooks
// its triggers named (`declaredWebhookPaths`). The payer agreed to those
// webhooks and no others: a stored snapshot without `webhookPaths` reads as
// agreeing to none (`capsSnapshotFromJSON`).
export type AutomationCapsSnapshot = AutomationCaps & {
  batchedAI: boolean;
  webhookPaths: string[];
};

// A trigger's run state as the row keeps it: what the schedule reads, plus
// what the index hook compares to tell when a trigger starts afresh and its
// cursor must move up to the edit:
// - `timing`: the trigger's timing when the row last followed the card (see
//   `triggerTiming`). A change is an edit to when it fires.
// - `live`: whether the card had the trigger, unspent, when the row last
//   followed it. A trigger that comes back (re-added, or a spent one given a
//   higher `count` or a later `until`) starts at the edit, so the slots it
//   missed while gone don't collapse into a make-up run.
// - `declared`: whether the card declared the trigger when it last read as a
//   declaration. A label an edit removed keeps its run state, so the label
//   keeps its count if it comes back, and carries `declared: false`, so a
//   view that reads the row while the card doesn't read leaves the label
//   out. `live` can't tell the two apart: a spent trigger the card declares
//   isn't live either. A run state without `declared` predates the
//   flag and counts as declared.
export interface AutomationTriggerRuns extends TriggerRunState {
  timing?: string;
  live?: boolean;
  declared?: boolean;
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
  // What the declaration reader found wrong with the card, when `pauseReason`
  // is `invalid-declaration`; null otherwise.
  pauseProblems: AutomationProblem[] | null;
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
// - `realm-archived`: switch-on or resume found the automation's realm
//   archived. Its automations stay off until the realm is restored.
// - `unusable-webhook`: switch-on or resume found a webhook trigger naming a
//   webhook the realm can't use (see `automation-webhooks.ts`). `problems`
//   says which trigger and why.
// - `not-admitted`: resume's admission of the caller as the payer refused
//   them (see `admitPayer`). `refusal` holds the code their first run would
//   end with, and why.
export type AutomationRefusal =
  | {
      ok: false;
      reason:
        | 'not-a-direct-writer'
        | 'missing'
        | 'outside-realm'
        | 'other-card'
        | 'realm-archived';
    }
  | {
      ok: false;
      reason: 'already-switched-on' | 'not-paused' | 'not-pausable';
      automation: AutomationRow;
    }
  | {
      ok: false;
      reason: 'unusable-webhook';
      problems: AutomationProblem[];
    }
  | {
      ok: false;
      reason: 'not-admitted';
      refusal: AdmissionRefusal;
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
// already starts *done*. `keyApproved` says whether every declared operation
// has the key approvals it needs, as checked for `user` before the change
// (`CheckAutomationKeyApprovals`); when it hasn't, the automation starts
// *waiting for key approval*, with no next run. Absent, the automation needs
// none.
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
    keyApproved = true,
  }: {
    automationId: RealmResourceIdentifier;
    realm: RealmIdentifier;
    user: string;
    declaration: AutomationDeclaration;
    keyApproved?: boolean;
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
  let schedule = awaitingKeyApproval(
    startSchedule(declaration, now, {}),
    keyApproved,
  );
  return await withChanges(dbAdapter, options, async (txQuery, changes) => {
    await lockRealmAutomations(txQuery, realm, 'shared');
    if (!(await isDirectWriterOf(txQuery, realm, user, options))) {
      return { ok: false, reason: 'not-a-direct-writer' };
    }
    if (await isArchived(txQuery, realm, options)) {
      return { ok: false, reason: 'realm-archived' };
    }
    let problems = await webhookProblems(txQuery, realm, declaration, options);
    if (problems.length) {
      return { ok: false, reason: 'unusable-webhook', problems };
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

// Pauses an automation for `user`, a direct writer of its realm, cancels its
// pending run and its running one (see `cancelUnfinishedAutomationRuns`), and
// holds its batch follow-ups (`holdAutomationFollowUpRuns`). An automation
// that is paused already keeps the reason it has.
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
      automation: await pause(txQuery, changes, automationId, 'requested', {
        pausedBy: user,
      }),
    };
  });
}

// Resumes a paused automation for `user`, a direct writer of its realm, who
// becomes its payer, with a new snapshot of the caps `declaration` (read from
// the card now) sets. Its schedule starts again now, so the slots that passed
// while it was paused don't run. Each trigger keeps its run count. Its
// failure streak starts afresh: runs created before the resume no longer
// count toward a pause for repeated failures. Each batch follow-up the pause
// held acts as, and is billed to, `user` from the resume on
// (`follow_up_acts_as`), its authority dating from the resume
// (`follow_up_resumed_at`); the batch itself stays billed to the submitting
// run's identity (ADR 030 §1.5). The caller then starts those follow-ups
// (`startResumedAIBatchFollowUps`).
//
// `admit` admits `user` as the payer the way a run of the automation's
// triggers would be admitted (`admitPayer`), told when the automation's
// first run after the resume could start (`firstRunAfterResume`), and its
// refusal leaves the automation paused (`not-admitted`). It asks the Matrix
// server and the realm, so it is asked before the change's transaction, of a
// resume that would otherwise go ahead: the automation is paused, `user`
// directly writes its realm and the realm isn't archived. Any other resume
// gets the refusal that says why, from the checks the transaction makes
// again under its locks. A transaction that finds the automation paused
// though `admit` wasn't asked (a pause committed after the first read) asks
// it then and starts again, so a resume never makes a payer it didn't admit.
export async function resumeAutomation(
  dbAdapter: DBAdapter,
  {
    automationId,
    user,
    declaration,
    admit,
    keyApproved,
  }: {
    automationId: RealmResourceIdentifier;
    user: string;
    declaration: AutomationDeclaration;
    admit: (
      payer: string,
      firstRun: { at: number | null },
    ) => Promise<AdmissionRefusal | undefined>;
    // Whether every declared operation has the key approvals it needs with
    // `payer` as the payer. Asked with `admit`; when it answers false the
    // automation resumes *waiting for key approval*. Absent, the automation
    // needs none.
    keyApproved?: (payer: string) => Promise<boolean>;
  },
  options: AutomationActorOptions,
): Promise<AutomationChange> {
  if (!isDeclarationOf(declaration, automationId, options)) {
    return { ok: false, reason: 'other-card' };
  }
  let now = options.now ?? currentUnixSeconds();
  let admitted = false;
  let approved = true;
  // The first attempt admits only a resume that would go ahead as read. When
  // its transaction answers `admit-first`, the second attempt admits whatever
  // it reads, so its transaction never answers `admit-first`: either `admit`
  // ran, or the row is gone and the transaction answers `missing`.
  for (let attempt = 0; attempt < 2; attempt++) {
    let current = await getAutomation(dbAdapter, automationId);
    if (
      current &&
      (attempt > 0 || (await wouldResume(dbAdapter, current, user, options)))
    ) {
      let refusal = await admit(user, {
        at: firstRunAfterResume(declaration, current.triggerRuns, now),
      });
      if (refusal) {
        return { ok: false, reason: 'not-admitted', refusal };
      }
      admitted = true;
      approved = keyApproved ? await keyApproved(user) : true;
    }
    let change = await resumeInTransaction(dbAdapter, {
      automationId,
      user,
      declaration,
      admitted,
      keyApproved: approved,
      now,
      options,
    });
    if (change !== 'admit-first') {
      return change;
    }
  }
  throw new Error(
    `resuming ${automationId} asked for admission after its second attempt, which admits whatever it reads`,
  );
}

// Whether a resume of `current` by `user` would go ahead, read outside any
// transaction: it is paused, `user` directly writes its realm, and the realm
// isn't archived.
async function wouldResume(
  dbAdapter: DBAdapter,
  current: AutomationRow,
  user: string,
  options: AutomationActorOptions,
): Promise<boolean> {
  return (
    current.state === 'paused' &&
    (await isDirectWriter(
      dbAdapter,
      options.virtualNetwork.toURL(current.realm),
      user,
      options.matrixServerName,
    )) &&
    !(await isArchived(dbAdapterQuerier(dbAdapter), current.realm, options))
  );
}

// When the first run after resuming at `now` could start, in unix seconds:
// `now` for an automation with a webhook trigger, which a delivery can fire
// at any time; otherwise the schedule's next run; null when nothing would
// run.
export function firstRunAfterResume(
  declaration: AutomationDeclaration,
  triggerRuns: Record<string, AutomationTriggerRuns>,
  now: number,
): number | null {
  if (declaration.triggers.some((trigger) => trigger.kind === 'webhook')) {
    return now;
  }
  let { nextRun } = startSchedule(declaration, now, triggerRuns);
  return nextRun === null ? null : Math.floor(Date.parse(nextRun) / 1000);
}

// The resume's transaction. Answers `admit-first` when it finds the
// automation ready to resume but its payer wasn't admitted.
async function resumeInTransaction(
  dbAdapter: DBAdapter,
  {
    automationId,
    user,
    declaration,
    admitted,
    keyApproved,
    now,
    options,
  }: {
    automationId: RealmResourceIdentifier;
    user: string;
    declaration: AutomationDeclaration;
    admitted: boolean;
    keyApproved: boolean;
    now: number;
    options: AutomationActorOptions;
  },
): Promise<AutomationChange | 'admit-first'> {
  return await withChanges(dbAdapter, options, async (txQuery, changes) => {
    // The realm's automation lock comes before the permission and automation
    // rows, the order archiving's pause takes it in (see
    // `lockRealmAutomations`).
    let seen = await selectAutomation(txQuery, automationId);
    if (seen) {
      await lockRealmAutomations(
        txQuery,
        automationFromRow(seen).realm,
        'shared',
      );
    }
    // The webhooks' owners' permission rows lock before the automation's row,
    // the order every change takes a permission row and an automation row in.
    // The problems are reported only to a direct writer, below.
    let problems = seen
      ? await webhookProblems(
          txQuery,
          automationFromRow(seen).realm,
          declaration,
          options,
        )
      : [];
    let found = await lockForDirectWriter(txQuery, automationId, user, options);
    if (!found.ok) {
      return found;
    }
    if (found.automation.state !== 'paused') {
      return { ok: false, reason: 'not-paused', automation: found.automation };
    }
    if (await isArchived(txQuery, found.automation.realm, options)) {
      return { ok: false, reason: 'realm-archived' };
    }
    if (problems.length) {
      return { ok: false, reason: 'unusable-webhook', problems };
    }
    if (!admitted) {
      return 'admit-first';
    }
    let schedule = awaitingKeyApproval(
      startSchedule(declaration, now, found.automation.triggerRuns),
      keyApproved,
    );
    let [row] = await txQuery([
      'UPDATE automations SET payer =',
      param(user),
      ', state =',
      param(schedule.state),
      ', pause_reason = NULL, paused_by = NULL, pause_problems = NULL, caps_snapshot =',
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
    await txQuery([
      'UPDATE ai_batches b SET follow_up_acts_as =',
      param(user),
      ', follow_up_resumed_at =',
      param(unixSecondsToISO(now)),
      '::timestamptz WHERE b.automation_id =',
      param(automationId),
      'AND',
      ...followUpNotStarted(),
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
    await dropHeldFollowUps(txQuery, automationId);
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

// Whether the card names an incoming webhook the snapshot doesn't, and so
// pauses with `webhook-changed`. Removing a webhook trigger asks for nothing
// more.
export function webhooksChangedFrom(
  snapshot: AutomationCapsSnapshot,
  card: Pick<AutomationDeclaration, 'triggers'>,
): boolean {
  let agreed = new Set(snapshot.webhookPaths);
  return declaredWebhookPaths(card).some((path) => !agreed.has(path));
}

// The reason a switched-on automation pauses for a card that asks for more
// than its payer agreed to (`capsRaisedAbove`, `webhooksChangedFrom`), or
// undefined when the card asks for no more.
function agreementExceededBy(
  snapshot: AutomationCapsSnapshot,
  declaration: Pick<AutomationDeclaration, 'caps' | 'batchedAI' | 'triggers'>,
):
  | Extract<
      AutomationPauseReason,
      'caps-raised' | 'batched-ai-enabled' | 'webhook-changed'
    >
  | undefined {
  return (
    capsRaisedAbove(snapshot, declaration) ??
    (webhooksChangedFrom(snapshot, declaration) ? 'webhook-changed' : undefined)
  );
}

// Checks the automation's card, as just indexed, against its caps snapshot,
// and pauses it when the card asks for more (`capsRaisedAbove`, and
// `webhooksChangedFrom` when `card` carries its triggers). An
// automation already paused keeps the reason it has: a resume takes a new
// snapshot whatever paused it. Returns the row, or undefined when the
// automation isn't switched on.
export async function checkAutomationCaps(
  dbAdapter: DBAdapter,
  automationId: RealmResourceIdentifier,
  card: Pick<AutomationDeclaration, 'caps' | 'batchedAI'> &
    Partial<Pick<AutomationDeclaration, 'triggers'>>,
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
    let reason = agreementExceededBy(automation.capsSnapshot, {
      ...card,
      triggers: card.triggers ?? [],
    });
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
// paused automation and each canceled run once the pause commits. The streak
// is read from the runs, so calling this again, or for a run that didn't
// fail, changes nothing, and a call a crash skipped is made up by the next
// failed run's.
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

// What a webhook delivery did to one automation (`takeWebhookDelivery`):
//
// - `started`: the automation takes the delivery. `runs` holds a run for each
//   of the triggers named, acting as the payer, with the delivery's slot. A run is `created` by this call, or found: a redelivery finds the
//   run the first delivery made, whatever its state.
// - `paused`: the webhook's owner is no longer a direct writer of the
//   automation's realm, so the automation paused with
//   `webhook-owner-lost-access` and the delivery starts no run.
// - `skipped`: the automation takes no delivery. It isn't switched
//   on (`not-switched-on`); it is paused, waiting for key approval or *done*
//   (`not-active`); or its card asks for more than the caps snapshot agreed
//   to (`agreement-exceeded`), which the card's index hook pauses it for.
export type WebhookDeliveryTaken =
  | {
      kind: 'started';
      automation: AutomationRow;
      runs: { run: AutomationRun; created: boolean }[];
    }
  | { kind: 'paused'; automation: AutomationRow }
  | {
      kind: 'skipped';
      reason: 'not-switched-on' | 'not-active' | 'agreement-exceeded';
      automation: AutomationRow | undefined;
    };

// Takes a delivery to an incoming webhook, which `owner` made, for the
// automation, whose card names the webhook in the triggers labeled
// `triggers`. Only an automation that is active or *waiting for credits*,
// and whose card asks for no more than its caps snapshot agreed to, takes a
// delivery; the run's admission then decides whether the run goes ahead, as
// it does for a scheduled run.
//
// The webhook must be one the realm can use, which switch-on and resume
// check (`unusableWebhookProblems`) and which can stop being true while the
// automation is on: the owner can lose write. So each delivery asks again.
// An owner who is no longer a direct writer pauses the automation with
// `webhook-owner-lost-access`, cancelling its unfinished runs as any pause
// does, and starts nothing. A direct writer resumes it once the trigger names
// a webhook the realm can use.
//
// The owner's permission row is locked before the automation's row, the
// order every change here takes them in, so an owner who loses write
// meanwhile waits for this delivery to commit, and the next one pauses.
export async function takeWebhookDelivery(
  dbAdapter: DBAdapter,
  {
    automationId,
    owner,
    declaration,
    triggers,
    slot,
  }: {
    automationId: RealmResourceIdentifier;
    // Who made the incoming webhook the delivery came to.
    owner: string;
    // The automation's card, as the caller read it.
    declaration: Pick<AutomationDeclaration, 'caps' | 'batchedAI' | 'triggers'>;
    triggers: string[];
    // Each run's slot: the delivery's (`webhookDeliverySlot`).
    slot: string;
  },
  options: Omit<AutomationActorOptions, 'now'>,
): Promise<WebhookDeliveryTaken> {
  return await withChanges(dbAdapter, options, async (txQuery, changes) => {
    let seen = await selectAutomation(txQuery, automationId);
    if (!seen) {
      return {
        kind: 'skipped',
        reason: 'not-switched-on',
        automation: undefined,
      };
    }
    let { realm } = automationFromRow(seen);
    let ownerWrites = await isDirectWriterOf(txQuery, realm, owner, options);
    let row = await selectAutomation(txQuery, automationId, { lock: true });
    if (!row) {
      return {
        kind: 'skipped',
        reason: 'not-switched-on',
        automation: undefined,
      };
    }
    let automation = automationFromRow(row);
    if (
      automation.state !== 'active' &&
      automation.state !== 'waiting-for-credits'
    ) {
      return { kind: 'skipped', reason: 'not-active', automation };
    }
    if (agreementExceededBy(automation.capsSnapshot, declaration)) {
      return { kind: 'skipped', reason: 'agreement-exceeded', automation };
    }
    if (!ownerWrites) {
      return {
        kind: 'paused',
        automation: await pause(
          txQuery,
          changes,
          automationId,
          'webhook-owner-lost-access',
        ),
      };
    }
    let runs: { run: AutomationRun; created: boolean }[] = [];
    for (let trigger of triggers) {
      runs.push(
        await insertOrFindAutomationRun(txQuery, {
          automationId,
          realm: automation.realm,
          trigger,
          slot,
          actsAs: automation.payer,
        }),
      );
    }
    if (runs.some(({ created }) => created)) {
      await txQuery([
        'UPDATE automations SET last_enqueued_at = now(), updated_at = now() WHERE automation_id =',
        param(automationId),
      ]);
    }
    return { kind: 'started', automation, runs };
  });
}

// Moves an active automation to *waiting for credits* (`waiting: true`), or a
// waiting one back to active (`waiting: false`), when `payer` is still its
// payer. A run's admission makes both moves: a run of the payer's that the
// balance check refuses, and the next one it admits. An automation that is
// paused or *done*, or whose payer a resume changed, is left alone, so neither
// move can undo a pause or a schedule that has ended. It is one conditional
// UPDATE, so a pause or a *done* that commits first wins, and the move then
// changes nothing. A move is reported to `reporters` once the UPDATE has
// committed. Returns the row as it is after the change, or undefined when
// nothing moved.
export async function setAutomationWaitingForCredits(
  dbAdapter: DBAdapter,
  automationId: RealmResourceIdentifier,
  { payer, waiting }: { payer: string; waiting: boolean },
  reporters: AutomationReporters = {},
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
  if (!row) {
    return undefined;
  }
  let automation = automationFromRow(row);
  await reporters.reportAutomationChange?.({
    automationId: automation.automationId,
    realm: automation.realm,
  });
  return automation;
}

// The states an approval that stops matching moves to *waiting for key
// approval*: those that run, or would run again. A paused automation keeps
// its pause, which takes precedence.
const LEAVES_FOR_KEY_APPROVAL: readonly AutomationState[] = [
  'active',
  'done',
  'waiting-for-credits',
];

// What following an automation's key approvals did:
//
// - `approved`: it was waiting for key approval, and every approval now
//   matches, so its schedule starts from now (active or *done*).
// - `waiting`: an approval it needs is missing or no longer matches, so it
//   moved to *waiting for key approval* and its pending runs were canceled.
// - `unchanged`: it is paused, or already where its approvals put it, or
//   `check` couldn't tell.
export type KeyApprovalFollow = {
  kind: 'approved' | 'waiting' | 'unchanged';
  automation: AutomationRow;
};

// Brings a switched-on automation's state in step with its key approvals.
// `check` reads the automation's card and script and checks every declared
// operation's approvals against them with the row's payer
// (`CheckAutomationKeyApprovals`), once the row is locked, so an approval
// landing and an edit that follow each other leave the row on the later one.
// It answers undefined when the card doesn't read as a declaration, which
// leaves the row as it is. Returns what it did, or undefined when the
// automation isn't switched on.
export async function followKeyApprovals(
  dbAdapter: DBAdapter,
  automationId: RealmResourceIdentifier,
  check: (
    automation: AutomationRow,
  ) => Promise<
    { approved: boolean; declaration: AutomationDeclaration } | undefined
  >,
  options: AutomationReporters & { now?: number } = {},
): Promise<KeyApprovalFollow | undefined> {
  let now = options.now ?? currentUnixSeconds();
  return await withChanges(dbAdapter, options, async (txQuery, changes) => {
    let row = await selectAutomation(txQuery, automationId, { lock: true });
    if (!row) {
      return undefined;
    }
    let automation = automationFromRow(row);
    if (automation.state === 'paused') {
      return { kind: 'unchanged', automation };
    }
    let checked = await check(automation);
    if (!checked) {
      return { kind: 'unchanged', automation };
    }
    if (checked.approved) {
      if (automation.state !== 'waiting-for-key-approval') {
        return { kind: 'unchanged', automation };
      }
      let schedule = restartSchedule(checked.declaration, now, automation);
      let [updated] = await txQuery([
        'UPDATE automations SET state =',
        param(schedule.state),
        ', trigger_runs =',
        param(JSON.stringify(schedule.triggerRuns)),
        '::jsonb, next_run =',
        param(schedule.nextRun),
        '::timestamptz, updated_at = now() WHERE automation_id =',
        param(automationId),
        'RETURNING *',
      ]);
      let approved = automationFromRow(updated);
      changes.automations.push(approved);
      return { kind: 'approved', automation: approved };
    }
    if (!LEAVES_FOR_KEY_APPROVAL.includes(automation.state)) {
      return { kind: 'unchanged', automation };
    }
    return {
      kind: 'waiting',
      automation: await toKeyApprovalWait(txQuery, changes, automationId),
    };
  });
}

// Moves the automation to *waiting for key approval* when `payer` is still
// its payer and it is active, *done* or waiting for credits: a run's
// admission found that a key approval it needs has ended or stopped
// matching (`KEY_APPROVAL_REFUSAL_REASONS`). Its pending runs are canceled.
// A paused automation keeps its pause, and one a resume gave another payer
// is left alone. Returns the row when it moved, or undefined.
export async function waitForKeyApproval(
  dbAdapter: DBAdapter,
  automationId: RealmResourceIdentifier,
  { payer }: { payer: string },
  reporters: AutomationReporters = {},
): Promise<AutomationRow | undefined> {
  return await withChanges(dbAdapter, reporters, async (txQuery, changes) => {
    let row = await selectAutomation(txQuery, automationId, { lock: true });
    if (!row) {
      return undefined;
    }
    let automation = automationFromRow(row);
    if (
      automation.payer !== payer ||
      !LEAVES_FOR_KEY_APPROVAL.includes(automation.state)
    ) {
      return undefined;
    }
    return await toKeyApprovalWait(txQuery, changes, automationId);
  });
}

// Moves the locked row to *waiting for key approval*, with no next run,
// cancels its pending runs and holds its pending batch follow-ups
// (`holdAutomationFollowUpRuns`), which start again once it is active. A
// running run finishes: its calls are checked as every call is.
async function toKeyApprovalWait(
  txQuery: Querier,
  changes: AutomationChanges,
  automationId: RealmResourceIdentifier,
): Promise<AutomationRow> {
  let [row] = await txQuery([
    "UPDATE automations SET state = 'waiting-for-key-approval', next_run = NULL, updated_at = now() WHERE automation_id =",
    param(automationId),
    'RETURNING *',
  ]);
  changes.canceled.push(
    ...(await cancelUnfinishedAutomationRuns(
      txQuery,
      automationId,
      { reason: 'waiting-for-key-approval' },
      { pendingOnly: true, keepFollowUps: true },
    )),
  );
  let waitHeld = await holdAutomationFollowUpRuns(txQuery, automationId, {
    pendingOnly: true,
  });
  changes.held.push(...waitHeld.held);
  changes.canceled.push(...waitHeld.ended);
  let waiting = automationFromRow(row);
  changes.automations.push(waiting);
  return waiting;
}

// What the index hook did with an automation's row:
//
// - `removed`: the card is deleted (`card-deleted`), or no longer adopts from
//   the catalog `Automation` type (`not-an-automation`), so the row is gone
//   and its pending and running runs are canceled.
// - `paused`: the card raised a cap or turned on `batchedAI`.
// - `waiting`: the card or its script changed what a key's owner approved,
//   so the automation waits for key approval.
// - `resumed`: the automation was paused with `invalid-declaration` and the
//   card reads again, so its schedule restarts.
// - `recomputed`: the next run, *done* and the trigger cursors follow the
//   card as indexed, or, for an automation paused with
//   `invalid-declaration`, its problems follow the card.
// - `unchanged`: the schedule stays as it was. It is paused or waiting for
//   key approval, or the card failed to index or doesn't read as a
//   declaration, so there is nothing to schedule from until a later index
//   reads it. A card that reads still has the row record which labels it
//   declares (`withDeclaredLabels`).
export type AutomationSync =
  | {
      kind: 'removed';
      reason: 'card-deleted' | 'not-an-automation';
      automation: AutomationRow;
    }
  | {
      kind: 'paused' | 'waiting' | 'resumed' | 'recomputed' | 'unchanged';
      automation: AutomationRow;
    };

export interface AutomationSyncOptions extends AutomationReporters {
  // `automationRef` as `internalKeyFor` spells it in the realm the index
  // reads, as `readAutomationDeclaration` takes it.
  automationTypeKey: string;
  virtualNetwork: Pick<VirtualNetwork, 'toURL' | 'toURLHref'>;
  // Unix seconds; the current time when absent.
  now?: number;
  // Whether the automation's key approvals still match it with its card as
  // just read: false when one of them no longer matches the automation's
  // version, true or undefined when none was found that doesn't. Absent, no
  // approval is compared.
  keyApprovalsMatch?: (
    automation: AutomationRow,
    declaration: AutomationDeclaration,
  ) => Promise<boolean | undefined>;
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
// card that asks for more than the caps snapshot pauses the automation, as
// does a card that names an incoming webhook the snapshot doesn't
// (`webhooksChangedFrom`), and a
// paused one keeps its reason and its schedule until a resume restarts it.
// An edit that changes what a key's owner approved (`keyApprovalsMatch`)
// moves an active, *done* or *waiting for credits* automation to *waiting for
// key approval* at once, never at its next run; a waiting one keeps waiting
// until its approvals match again (`followKeyApprovals`).
//
// A card that doesn't read as a declaration leaves the row as it is: the card
// saves itself while someone edits it, so a trigger just added and not yet
// filled in, or an expression half typed, is an ordinary state to pass
// through, never a reason to stop the automation. The tick pauses the
// automation only when a run comes due while the card is in that state
// (`pauseForInvalidDeclaration`). An automation paused that way follows the
// card: its problems are replaced by the card's current ones, and once the
// card reads again it resumes, as `resumeAutomation` would with the same
// payer and caps snapshot, unless the card now raises a cap, which pauses it
// with that reason instead.
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
      if (
        automation.pauseReason !== 'invalid-declaration' ||
        sameProblems(automation.pauseProblems, read.problems)
      ) {
        return { kind: 'unchanged', automation };
      }
      let [updated] = await txQuery([
        'UPDATE automations SET pause_problems =',
        param(JSON.stringify(read.problems)),
        '::jsonb, updated_at = now() WHERE automation_id =',
        param(automationId),
        'RETURNING *',
      ]);
      let followed = automationFromRow(updated);
      changes.automations.push(followed);
      return { kind: 'recomputed', automation: followed };
    }
    let { declaration } = read;
    // The branches below that keep the row's schedule (a pause, a wait for
    // key approval) leave `trigger_runs` as it is, so the labels the card
    // declares are recorded here first. A view that reads the row while the
    // card doesn't read then lists only the triggers of the card's last
    // readable edit.
    let declaredRuns = withDeclaredLabels(
      automation.triggerRuns,
      declaration.triggers,
    );
    if (declaredRuns) {
      let [updated] = await txQuery([
        'UPDATE automations SET trigger_runs =',
        param(JSON.stringify(declaredRuns)),
        '::jsonb, updated_at = now() WHERE automation_id =',
        param(automationId),
        'RETURNING *',
      ]);
      automation = automationFromRow(updated);
    }
    if (automation.pauseReason === 'invalid-declaration') {
      let raised = agreementExceededBy(automation.capsSnapshot, declaration);
      if (raised) {
        return {
          kind: 'paused',
          automation: await pause(txQuery, changes, automationId, raised),
        };
      }
      // An edit made while the card didn't read can change what a key's
      // owner approved, so the automation resumes waiting when it did.
      let schedule = awaitingKeyApproval(
        restartSchedule(declaration, now, automation),
        (await options.keyApprovalsMatch?.(automation, declaration)) !== false,
      );
      let [row] = await txQuery([
        'UPDATE automations SET state =',
        param(schedule.state),
        ', pause_reason = NULL, paused_by = NULL, pause_problems = NULL, trigger_runs =',
        param(JSON.stringify(schedule.triggerRuns)),
        '::jsonb, next_run =',
        param(schedule.nextRun),
        '::timestamptz, updated_at = now() WHERE automation_id =',
        param(automationId),
        'RETURNING *',
      ]);
      let resumed = automationFromRow(row);
      changes.automations.push(resumed);
      return { kind: 'resumed', automation: resumed };
    }
    if (automation.state === 'paused') {
      return { kind: 'unchanged', automation };
    }
    let reason = agreementExceededBy(automation.capsSnapshot, declaration);
    if (reason) {
      return {
        kind: 'paused',
        automation: await pause(txQuery, changes, automationId, reason),
      };
    }
    if (automation.state === 'waiting-for-key-approval') {
      return { kind: 'unchanged', automation };
    }
    if (
      (await options.keyApprovalsMatch?.(automation, declaration)) === false
    ) {
      return {
        kind: 'waiting',
        automation: await toKeyApprovalWait(txQuery, changes, automationId),
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

// Pauses the automation with `invalid-declaration` when its card, read once
// the automation's row is locked, still doesn't read as a declaration. The
// tick asks when a run comes due and the card fails to read, so the
// automation says why instead of silently skipping its runs. `readProblems`
// reads the card's problems, or undefined when the card reads, or carries
// nothing to read (not indexed, failed to index), which is no reason to
// pause. The pause cancels pending runs and leaves a running run to finish.
// An automation already paused keeps its reason. The index hook lifts this
// pause once the card reads again (`syncAutomationWithCard`). Returns the row,
// or undefined when the automation isn't switched on.
export async function pauseForInvalidDeclaration(
  dbAdapter: DBAdapter,
  automationId: RealmResourceIdentifier,
  readProblems: () => Promise<AutomationProblem[] | undefined>,
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
    let problems = await readProblems();
    if (!problems?.length) {
      return automation;
    }
    return await pause(txQuery, changes, automationId, 'invalid-declaration', {
      problems,
      keepRunning: true,
    });
  });
}

// Whether two lists of declaration problems say the same things in the same
// order.
function sameProblems(
  a: AutomationProblem[] | null,
  b: AutomationProblem[],
): boolean {
  return (
    a !== null &&
    a.length === b.length &&
    a.every(
      (p, i) =>
        p.code === b[i].code &&
        p.path === b[i].path &&
        p.message === b[i].message,
    )
  );
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
    await lockRealmAutomations(txQuery, realm, 'exclusive');
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
  await dropHeldFollowUps(txQuery, automation.automationId);
  await txQuery([
    'DELETE FROM automations WHERE automation_id =',
    param(automation.automationId),
  ]);
  changes.automations.push(automation);
  return { kind: 'removed', reason, automation };
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
// under `schedule`. A label the card doesn't declare is recorded as neither
// live nor declared.
export function recordTriggers(
  triggerRuns: Record<string, AutomationTriggerRuns>,
  triggers: AutomationTriggerDeclaration[],
  schedule: AutomationSchedule,
): Record<string, AutomationTriggerRuns> {
  let spent = new Map(schedule.triggers.map((t) => [t.label, t.spent]));
  let next: Record<string, AutomationTriggerRuns> = {};
  for (let [label, state] of Object.entries(triggerRuns)) {
    next[label] = { ...state, live: false, declared: false };
  }
  for (let trigger of triggers) {
    next[trigger.label] = {
      ...(next[trigger.label] ?? { runs: 0 }),
      timing: triggerTiming(trigger),
      live: !spent.get(trigger.label),
      declared: true,
    };
  }
  return next;
}

// Records which labels the card declares, for a row that keeps its schedule
// through an edit (paused, or waiting for key approval). A label the row has
// a run state for keeps its cursor, `timing` and `live`. A label the row
// lacks gets `{ runs: 0, live: false, declared: true }`: no cursor, so the
// schedule reads it as it reads an absent label. Whatever ends the pause or
// the wait (`startSchedule`, `restartSchedule`) starts it at that moment.
// Returns undefined when the row already records the card's labels.
export function withDeclaredLabels(
  triggerRuns: Record<string, AutomationTriggerRuns>,
  triggers: AutomationTriggerDeclaration[],
): Record<string, AutomationTriggerRuns> | undefined {
  let declared = new Set(triggers.map((t) => t.label));
  let next: Record<string, AutomationTriggerRuns> = {};
  let changed = false;
  for (let [label, state] of Object.entries(triggerRuns)) {
    let isDeclared = declared.has(label);
    if ((state.declared ?? true) !== isDeclared) {
      changed = true;
    }
    next[label] = { ...state, declared: isDeclared };
  }
  for (let label of declared) {
    if (!next[label]) {
      changed = true;
      next[label] = { runs: 0, live: false, declared: true };
    }
  }
  return changed ? next : undefined;
}

// The labels to list for an automation whose card can't be read: each label
// the row has a run state for that the card declared when the card last read.
// A label an edit removed stays in the row, so the label keeps its count if
// it comes back, and is left out here.
export function lastDeclaredLabels(
  triggerRuns: Record<string, AutomationTriggerRuns>,
): string[] {
  return Object.entries(triggerRuns)
    .filter(([, state]) => state.declared !== false)
    .map(([label]) => label);
}

// Pauses the row, cancels its pending and running runs, and holds its batch
// follow-ups, pending or running (`holdAutomationFollowUpRuns`). A run a
// person's pause cancels names them in `canceled_by`; one any other pause
// cancels names no one, and carries the pause's reason in `error_reason`.
async function pause(
  txQuery: Querier,
  changes: AutomationChanges,
  automationId: RealmResourceIdentifier,
  reason: AutomationPauseReason,
  {
    pausedBy,
    problems,
    keepRunning = false,
  }: {
    pausedBy?: string;
    problems?: AutomationProblem[];
    // Leave a running run to finish, a follow-up among them, and cancel or
    // hold only pending ones.
    keepRunning?: boolean;
  } = {},
): Promise<AutomationRow> {
  let [row] = await txQuery([
    "UPDATE automations SET state = 'paused', pause_reason =",
    param(reason),
    ', paused_by =',
    param(pausedBy ?? null),
    ', pause_problems =',
    param(problems ? JSON.stringify(problems) : null),
    '::jsonb, updated_at = now() WHERE automation_id =',
    param(automationId),
    'RETURNING *',
  ]);
  changes.canceled.push(
    ...(await cancelUnfinishedAutomationRuns(
      txQuery,
      automationId,
      pausedBy ? { canceledBy: pausedBy } : { reason },
      { pendingOnly: keepRunning, keepFollowUps: true },
    )),
  );
  let pauseHeld = await holdAutomationFollowUpRuns(txQuery, automationId, {
    pendingOnly: keepRunning,
  });
  changes.held.push(...pauseHeld.held);
  changes.canceled.push(...pauseHeld.ended);
  let paused = automationFromRow(row);
  changes.automations.push(paused);
  return paused;
}

// What a change did, for its reporters: the runs it canceled, the batch
// follow-ups it held, and the automations whose rows it changed.
interface AutomationChanges {
  canceled: AutomationRun[];
  held: AutomationRun[];
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
// Serializes starting a realm's automations with stopping them all. Switch-on
// and resume take it shared, so they never wait on each other;
// `pauseRealmAutomations` takes it exclusive. Each holds it to the end of its
// transaction, and takes it before any permission or automation row, so a
// switch-on or resume that read the realm as not archived commits before a
// pause of the whole realm reads which automations to pause.
async function lockRealmAutomations(
  txQuery: Querier,
  realm: RealmIdentifier,
  mode: 'shared' | 'exclusive',
): Promise<void> {
  await txQuery([
    mode === 'shared'
      ? 'SELECT pg_advisory_xact_lock_shared(hashtext('
      : 'SELECT pg_advisory_xact_lock(hashtext(',
    param(`automations-of-realm:${realm}`),
    '))',
  ]);
}

// Whether the realm is archived, as its metadata row, keyed by the served
// URL, says.
async function isArchived(
  txQuery: Querier,
  realm: RealmIdentifier,
  { virtualNetwork }: Pick<AutomationActorOptions, 'virtualNetwork'>,
): Promise<boolean> {
  let [row] = await txQuery([
    'SELECT archived_at FROM realm_metadata WHERE url =',
    param(virtualNetwork.toURL(realm).href),
  ]);
  return !!row && row.archived_at != null;
}

async function withChanges<T>(
  dbAdapter: DBAdapter,
  { reportRunChange, reportAutomationChange }: AutomationReporters,
  change: (txQuery: Querier, changes: AutomationChanges) => Promise<T>,
): Promise<T> {
  let changes: AutomationChanges = { canceled: [], held: [], automations: [] };
  let result = await dbAdapter.withTransaction((txQuery) => {
    changes = { canceled: [], held: [], automations: [] };
    return change(txQuery, changes);
  });
  for (let run of changes.canceled) {
    await logAutomationRunEnded(dbAdapter, run);
  }
  for (let run of changes.held) {
    await logRunPlatformLine(dbAdapter, run.id, {
      kind: 'trigger',
      level: 'info',
      message:
        "The automation stopped, so this batch's follow-up is held: it starts again once the automation is resumed or active again",
      data: { held: true },
    });
  }
  await reportRunChanges(reportRunChange, [
    ...changes.canceled,
    ...changes.held,
  ]);
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

interface StartedSchedule {
  state: 'active' | 'done' | 'waiting-for-key-approval';
  nextRun: string | null;
  triggerRuns: Record<string, AutomationTriggerRuns>;
}

// The schedule an automation starts with when its key approvals are or
// aren't all there: one that would run waits, with no next run, until they
// are. One with nothing left to run is *done* either way, since it needs no
// key again.
function awaitingKeyApproval(
  schedule: StartedSchedule,
  keyApproved: boolean,
): StartedSchedule {
  return keyApproved || schedule.state === 'done'
    ? schedule
    : { ...schedule, state: 'waiting-for-key-approval', nextRun: null };
}

// The state and next run of a schedule that starts again at `now` for an
// automation that stays switched on under the same payer: a wait for key
// approval ending, or an `invalid-declaration` pause lifting. Each trigger's
// cursor moves up to `now`, so a slot that passed meanwhile never runs, and
// `scheduled_since` stays as it is: it is when the payer switched the
// automation on or last resumed it, the moment a trigger run's admission
// holds a revocation of the payer's sessions against.
function restartSchedule(
  declaration: AutomationDeclaration,
  now: number,
  automation: Pick<AutomationRow, 'scheduledSince' | 'triggerRuns'>,
): StartedSchedule {
  let cursors: Record<string, AutomationTriggerRuns> = {
    ...automation.triggerRuns,
  };
  for (let trigger of declaration.triggers) {
    cursors[trigger.label] = {
      ...(cursors[trigger.label] ?? { runs: 0 }),
      since: now,
    };
  }
  let schedule = computeAutomationSchedule({
    triggers: declaration.triggers,
    since: automation.scheduledSince,
    now,
    runState: cursors,
  });
  return {
    triggerRuns: recordTriggers(cursors, declaration.triggers, schedule),
    state: schedule.done ? 'done' : 'active',
    nextRun:
      schedule.nextRun === undefined
        ? null
        : unixSecondsToISO(schedule.nextRun),
  };
}

// The state and next run of a schedule that starts at `now`.
function startSchedule(
  declaration: AutomationDeclaration,
  now: number,
  triggerRuns: Record<string, AutomationTriggerRuns>,
): StartedSchedule {
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

// The card's caps, keyed by name, its `batchedAI`, and the incoming webhooks
// its triggers name. Only the caps the declaration names are kept.
function snapshotCaps(
  declaration: Pick<AutomationDeclaration, 'caps' | 'batchedAI' | 'triggers'>,
): AutomationCapsSnapshot {
  return {
    ...Object.fromEntries(
      AUTOMATION_CAP_NAMES.map((name) => [name, declaration.caps[name]]),
    ),
    batchedAI: declaration.batchedAI,
    webhookPaths: declaredWebhookPaths(declaration),
  } as AutomationCapsSnapshot;
}

// `unusableWebhookProblems` for the automation's realm, asked of the served
// URL its permission rows are keyed by.
async function webhookProblems(
  txQuery: Querier,
  realm: RealmIdentifier,
  declaration: AutomationDeclaration,
  {
    matrixServerName,
    virtualNetwork,
  }: Pick<AutomationActorOptions, 'matrixServerName' | 'virtualNetwork'>,
): Promise<AutomationProblem[]> {
  return await unusableWebhookProblems(
    txQuery,
    virtualNetwork.toURL(realm),
    declaration,
    matrixServerName,
  );
}

// A stored caps snapshot. One without `webhookPaths` agreed to no webhook, so
// any webhook its card names pauses the automation with `webhook-changed`,
// and no delivery starts its run (`startWebhookAutomationRuns`).
function capsSnapshotFromJSON(value: PgPrimitive): AutomationCapsSnapshot {
  let snapshot = json(value) as Omit<AutomationCapsSnapshot, 'webhookPaths'> & {
    webhookPaths?: string[];
  };
  return { ...snapshot, webhookPaths: snapshot.webhookPaths ?? [] };
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
    pauseProblems:
      row.pause_reason === 'invalid-declaration' && row.pause_problems != null
        ? (json(row.pause_problems) as AutomationProblem[])
        : null,
    capsSnapshot: capsSnapshotFromJSON(row.caps_snapshot),
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

// A batch of the automation, aliased `b`, whose follow-up hasn't started: it
// has none yet and none was dropped, or the one it has is held, or pending
// (enqueued and not yet taken). A held follow-up counts whatever its run's
// state: a job enqueued before the pause can take the run just before the
// resume, and admission then holds it again for the identity the resume
// sets. Its batch was submitted since the automation was last switched on,
// so it can still get a follow-up.
function followUpNotStarted(): Expression {
  return [
    'b.follow_up_dropped_at IS NULL',
    'AND b.submitted_at >= (SELECT a.switched_on_at FROM automations a WHERE a.automation_id = b.automation_id)',
    'AND (b.follow_up_held_at IS NOT NULL OR b.follow_up_run_id IS NULL OR EXISTS (SELECT 1 FROM automation_runs r',
    "WHERE r.id = b.follow_up_run_id AND r.state = 'pending'))",
  ];
}

// Clears the hold on each batch of a removed automation: its follow-up was
// canceled with the automation's other runs, and nothing starts it again.
// The batch is still settled and billed.
async function dropHeldFollowUps(
  txQuery: Querier,
  automationId: RealmResourceIdentifier,
): Promise<void> {
  await txQuery([
    'UPDATE ai_batches SET follow_up_held_at = NULL WHERE automation_id =',
    param(automationId),
    'AND follow_up_held_at IS NOT NULL',
  ]);
}
