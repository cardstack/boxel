// The automation row: one `automations` row per switched-on automation, and
// the functions that change it. The automation's card is its definition; the
// row is who pays for it and where it is (ADR 028 §1.3). Only the functions
// here set the payer, so writing the card can't make someone else pay.
//
//   switch on ──▶ active ──pause──▶ paused ──resume──▶ active
//                 (done)                            (done)
//
// Switch-on and resume start the automation *done* instead of active when
// every trigger is already spent. Remove deletes the row in any state. The
// tick moves an automation between active and *waiting for credits* on its
// payer's balance, and the card's index hook between active and *done* as its
// triggers are spent or added.
//
// A direct writer of the automation's realm switches an automation on,
// pauses, resumes or removes it. That is asked with `isDirectWriterLocked`
// inside the change's transaction, so a change to the person's permission row
// waits for the change to commit. Whoever switches it on or resumes it becomes its
// payer, and their caps are snapshotted. Two changes pause it without a
// person asking: a card edit that raises a cap above the snapshot or turns on
// `batchedAI` (`checkAutomationCaps`), and the payer no longer being a direct
// writer (`checkAutomationPayer`). Each ends only through a resume, which
// makes its caller the payer and takes a new snapshot.
//
// Pausing and removing cancel the automation's pending run, so nothing it
// queued starts once it stops. A run already running carries on.
//
// The tick, the card's index hook and the run task own `next_run`,
// `trigger_runs`, *waiting for credits*, *done* and the `last_*` columns once
// an automation is on. These functions set the next run and *done* only where
// they start a schedule: at switch-on and resume.

import {
  AUTOMATION_CAP_NAMES,
  type AutomationCaps,
  type AutomationDeclaration,
} from './automation-declaration.ts';
import { cancelPendingAutomationRuns } from './automation-runs.ts';
import {
  computeAutomationSchedule,
  type TriggerRunState,
} from './automation-schedule.ts';
import type { DBAdapter } from './db.ts';
import { isDirectWriterLocked } from './db-queries/realm-permission-queries.ts';
import { dbAdapterQuerier, param, type Querier } from './expression.ts';
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
// - `payer-lost-access`: its payer is no longer a direct writer of its realm.
// - `caps-raised`: its card raised a cap above the snapshot.
// - `batched-ai-enabled`: its card turned on `batchedAI`, which the snapshot
//   had off.
export type AutomationPauseReason =
  | 'requested'
  | 'payer-lost-access'
  | 'caps-raised'
  | 'batched-ai-enabled';

// The caps the payer agreed to pay for when they switched the automation on
// or resumed it, and whether it used batched AI then.
export type AutomationCapsSnapshot = AutomationCaps & { batchedAI: boolean };

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
  // `computeAutomationSchedule` reads as `runState`.
  triggerRuns: Record<string, TriggerRunState>;
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

// What every change made in a person's name needs: the paired homeserver,
// whose bot accounts are never direct writers, and a way to turn the
// automation's realm into the served URL its permission rows are keyed by.
export interface AutomationActorOptions {
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
  return await dbAdapter.withTransaction(async (txQuery) => {
    if (!(await isDirectWriterOf(txQuery, realm, user, options))) {
      return { ok: false, reason: 'not-a-direct-writer' };
    }
    let [inserted] = await txQuery([
      'INSERT INTO automations (automation_id, realm, payer, state, caps_snapshot, scheduled_since, next_run) VALUES (',
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
      param(unixSecondsToISO(now)),
      '::timestamptz,',
      param(schedule.nextRun),
      '::timestamptz) ON CONFLICT (automation_id) DO NOTHING RETURNING *',
    ]);
    if (inserted) {
      return { ok: true, automation: automationFromRow(inserted) };
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
// its pending run. An automation that is paused already keeps the reason it
// has.
export async function pauseAutomation(
  dbAdapter: DBAdapter,
  {
    automationId,
    user,
  }: { automationId: RealmResourceIdentifier; user: string },
  options: AutomationActorOptions,
): Promise<AutomationChange> {
  return await dbAdapter.withTransaction(async (txQuery) => {
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
      automation: await pause(txQuery, automationId, 'requested', user),
    };
  });
}

// Resumes a paused automation for `user`, a direct writer of its realm, who
// becomes its payer, with a new snapshot of the caps `declaration` (read from
// the card now) sets. Its schedule starts again now, so the slots that passed
// while it was paused don't run. Each trigger keeps its run count.
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
  return await dbAdapter.withTransaction(async (txQuery) => {
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
      '::jsonb, scheduled_since =',
      param(unixSecondsToISO(now)),
      '::timestamptz, next_run =',
      param(schedule.nextRun),
      '::timestamptz, updated_at = now() WHERE automation_id =',
      param(automationId),
      'RETURNING *',
    ]);
    return { ok: true, automation: automationFromRow(row) };
  });
}

// Removes an automation for `user`, a direct writer of its realm: deletes its
// row and cancels its pending run. Its card and script stay. It returns the
// row as it was.
export async function removeAutomation(
  dbAdapter: DBAdapter,
  {
    automationId,
    user,
  }: { automationId: RealmResourceIdentifier; user: string },
  options: AutomationActorOptions,
): Promise<AutomationChange> {
  return await dbAdapter.withTransaction(async (txQuery) => {
    let found = await lockForDirectWriter(txQuery, automationId, user, options);
    if (!found.ok) {
      return found;
    }
    await cancelPendingAutomationRuns(txQuery, automationId, {
      canceledBy: user,
    });
    await txQuery([
      'DELETE FROM automations WHERE automation_id =',
      param(automationId),
    ]);
    return { ok: true, automation: found.automation };
  });
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
): Promise<AutomationRow | undefined> {
  return await dbAdapter.withTransaction(async (txQuery) => {
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
    return await pause(txQuery, automationId, reason);
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
  return await dbAdapter.withTransaction(async (txQuery) => {
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
    return await pause(txQuery, automationId, 'payer-lost-access');
  });
}

// Pauses the row and cancels its pending run. A run a person's pause cancels
// names them in `canceled_by`; one any other pause cancels names no one, and
// carries the pause's reason in `error_reason`.
async function pause(
  txQuery: Querier,
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
  await cancelPendingAutomationRuns(
    txQuery,
    automationId,
    pausedBy ? { canceledBy: pausedBy } : { reason },
  );
  return automationFromRow(row);
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
function isDeclarationOf(
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

async function isDirectWriterOf(
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
  triggerRuns: Record<string, TriggerRunState>,
): { state: 'active' | 'done'; nextRun: string | null } {
  let schedule = computeAutomationSchedule({
    triggers: declaration.triggers,
    since: now,
    now,
    runState: triggerRuns,
  });
  return {
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

function automationFromRow(row: Record<string, PgPrimitive>): AutomationRow {
  return {
    automationId: row.automation_id as RealmResourceIdentifier,
    realm: row.realm as RealmIdentifier,
    payer: String(row.payer),
    state: row.state as AutomationState,
    pauseReason: (row.pause_reason as AutomationPauseReason | null) ?? null,
    pausedBy: (row.paused_by as string | null) ?? null,
    capsSnapshot: json(row.caps_snapshot) as AutomationCapsSnapshot,
    triggerRuns: json(row.trigger_runs) as Record<string, TriggerRunState>,
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
