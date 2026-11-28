// The daily storage charge (ADR 029): each switched-on automation's payer
// pays for the files its runs created, at the file storage rate, and for
// their rows in the index, at the database storage rate, for every day the
// automation is active.
//
// An automation is active on a day when the automation was `active` at any
// point in the day, as its `automation_state_changes` history records. A day
// the automation spent wholly paused, waiting for credits, waiting for key
// approval or done is neither measured nor charged. The files stay in the
// realm; only the charge stops. Resuming, the last key approval, the next
// run admitted once the payer's balance covers the run, or a new trigger on a
// done automation makes the automation active again, and the charge starts
// again from that day.
//
// Each day is priced at what existed that day. Just after a UTC day ends, the
// job measures each automation's files (see `getAutomationStorage`) and keeps
// the measurement as that day's `automation_storage_days` row. A day the job
// never measured is not charged.
//
// A day of a few small files costs a tiny fraction of a credit, and credits
// are whole numbers, so a charge covers every measured day since the
// automation's last storage charge (or since it was switched on), and is
// written only once those days cost at least a whole credit. The charge is
// named by its last day, so an automation is charged at most once a day, and
// a retried job writes nothing twice. Its usage records the GB-months of all
// the days it covers.
//
// Removing an automation deletes its `automations` row and its history, so
// the automation is no longer measured or charged. Switching the automation
// on again starts from that day.

import { getAutomationStorage } from './automation-files.ts';
import type { AutomationPauseReason, AutomationState } from './automations.ts';
import type { DBAdapter } from './db.ts';
import { param, query } from './index.ts';
import {
  BYTES_PER_GB,
  type MeteredChargeResult,
  type MeteredCharges,
} from './metered-charges.ts';
import type {
  RealmIdentifier,
  RealmResourceIdentifier,
} from './realm-identifiers.ts';

// An average month, in days: four years of days over their 48 months, the
// month the switch-on estimate counts runs over.
export const DAYS_PER_AVERAGE_MONTH = 1461 / 48;

export type AutomationStorageChargeOutcome =
  | MeteredChargeResult
  // The span costs less than a credit so far; a later day charges it.
  | 'under-a-credit'
  // The span through the day has been charged.
  | 'not-due'
  // The automation wasn't active at any point in the day, so the day is
  // neither measured nor charged.
  | 'stopped';

export interface AutomationStorageCharge {
  automationId: RealmResourceIdentifier;
  outcome: AutomationStorageChargeOutcome;
  // The days the charge covers, first and last, as YYYY-MM-DD.
  firstDay?: string;
  lastDay?: string;
  fileStorageGbMonths?: number;
  databaseStorageGbMonths?: number;
}

interface AutomationToCharge {
  automation_id: string;
  realm: string;
  payer: string;
  switched_on_day: string;
  last_charged_day: string | null;
  active_on_day: boolean;
}

// Charges the storage of every automation switched on before `day` ended,
// through `day`, a UTC YYYY-MM-DD date that has ended. One automation's
// failure doesn't stop the others; it is reported in `failed`, and the next
// day's charge covers its span, which still starts after its last charge.
export async function chargeAutomationStorage(
  dbAdapter: DBAdapter,
  meteredCharges: MeteredCharges,
  day: string,
): Promise<{
  charges: AutomationStorageCharge[];
  failed: { automationId: RealmResourceIdentifier; error: unknown }[];
}> {
  let automations = (await query(dbAdapter, [
    `SELECT a.automation_id, a.realm, a.payer,
       to_char(a.switched_on_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS switched_on_day,
       -- The null run and batch let the charge-once index serve this.
       (SELECT to_char(MAX(l.charge_day), 'YYYY-MM-DD') FROM credits_ledger l
        WHERE l.charge_kind = 'storage' AND l.run_id IS NULL
          AND l.batch_id IS NULL AND l.automation_id = a.automation_id)
         AS last_charged_day,
       -- Active on the day: active as the day began (after every change at
       -- or before midnight), or made active later in the day.
       (COALESCE((SELECT c.state FROM automation_state_changes c
                  WHERE c.automation_id = a.automation_id
                    AND c.changed_at <=`,
    param(`${day}T00:00:00Z`),
    `::timestamptz
                  ORDER BY c.changed_at DESC, c.id DESC LIMIT 1), '') = 'active'
        OR EXISTS (SELECT 1 FROM automation_state_changes c
                   WHERE c.automation_id = a.automation_id
                     AND c.state = 'active' AND c.changed_at >`,
    param(`${day}T00:00:00Z`),
    '::timestamptz AND c.changed_at <',
    param(`${addDays(day, 1)}T00:00:00Z`),
    `::timestamptz)) AS active_on_day
     FROM automations a WHERE a.switched_on_at <`,
    param(`${addDays(day, 1)}T00:00:00Z`),
    '::timestamptz ORDER BY a.automation_id',
  ])) as unknown as AutomationToCharge[];
  let charges: AutomationStorageCharge[] = [];
  let failed: { automationId: RealmResourceIdentifier; error: unknown }[] = [];
  for (let automation of automations) {
    try {
      charges.push(await chargeOne(dbAdapter, meteredCharges, automation, day));
    } catch (error: unknown) {
      failed.push({
        automationId: automation.automation_id as RealmResourceIdentifier,
        error,
      });
    }
  }
  return { charges, failed };
}

async function chargeOne(
  dbAdapter: DBAdapter,
  meteredCharges: MeteredCharges,
  automation: AutomationToCharge,
  day: string,
): Promise<AutomationStorageCharge> {
  let automationId = automation.automation_id as RealmResourceIdentifier;
  // The span starts the day after the last charge, unless the automation was
  // switched on again since, which starts a new one.
  let firstDay =
    automation.last_charged_day &&
    automation.last_charged_day >= automation.switched_on_day
      ? addDays(automation.last_charged_day, 1)
      : automation.switched_on_day;
  if (firstDay > day) {
    return { automationId, outcome: 'not-due' };
  }
  // A day the automation wasn't active gets no measurement, so no span ever
  // charges the day, and the days before the day wait for the next active
  // day's charge.
  if (!automation.active_on_day) {
    return { automationId, outcome: 'stopped' };
  }
  // A day is measured once: a duplicate or retried job finds its row and
  // skips the measurement. Two jobs measuring at once both insert, and the
  // first row stands.
  let [measuredAlready] = await query(dbAdapter, [
    'SELECT 1 FROM automation_storage_days WHERE automation_id =',
    param(automationId),
    'AND day =',
    param(day),
    '::date',
  ]);
  if (!measuredAlready) {
    let storage = await getAutomationStorage(dbAdapter, automationId);
    await query(dbAdapter, [
      'INSERT INTO automation_storage_days (automation_id, day, realm, file_bytes, index_bytes) VALUES (',
      param(automationId),
      ',',
      param(day),
      '::date,',
      param(automation.realm),
      ',',
      param(storage.fileBytes),
      ',',
      param(storage.indexBytes),
      ') ON CONFLICT (automation_id, day) DO NOTHING',
    ]);
  }
  // Each covered day at its own measurement: bytes summed over days are
  // byte-days.
  let [measured] = (await query(dbAdapter, [
    `SELECT COALESCE(SUM(file_bytes), 0) AS file_byte_days,
       COALESCE(SUM(index_bytes), 0) AS index_byte_days
     FROM automation_storage_days WHERE automation_id =`,
    param(automationId),
    'AND day BETWEEN',
    param(firstDay),
    '::date AND',
    param(day),
    '::date',
  ])) as unknown as { file_byte_days: string; index_byte_days: string }[];
  let fileStorageGbMonths =
    Number(measured.file_byte_days) / BYTES_PER_GB / DAYS_PER_AVERAGE_MONTH;
  let databaseStorageGbMonths =
    Number(measured.index_byte_days) / BYTES_PER_GB / DAYS_PER_AVERAGE_MONTH;
  let usage = {
    file_storage_gb_months: fileStorageGbMonths,
    database_storage_gb_months: databaseStorageGbMonths,
  };
  let span = {
    automationId,
    firstDay,
    lastDay: day,
    fileStorageGbMonths,
    databaseStorageGbMonths,
  };
  let exactCredits = meteredCharges.exactCredits(usage);
  if (exactCredits === undefined) {
    return { ...span, outcome: 'no-prices' };
  }
  if (exactCredits < 1) {
    return { ...span, outcome: 'under-a-credit' };
  }
  let outcome = await meteredCharges.charge({
    payer: automation.payer,
    charge: {
      kind: 'storage',
      realm: automation.realm as RealmIdentifier,
      automationId,
      day,
    },
    usage,
  });
  return { ...span, outcome };
}

// Why, and since when, an automation's storage isn't charged: the
// automation's current state when that state isn't `active`, with its pause
// reason, and `since`, when the automation last left `active` (or, for an
// automation that was never active, when the automation was switched on).
// Null for an active automation, and for one with no history. The charge
// stops from the first day the automation spends wholly stopped, `fromDay`
// (YYYY-MM-DD): the day after `since` when the automation was active earlier
// that day, otherwise `since`'s own day (a stop at exactly midnight, or an
// automation that was never active).
export interface StorageChargeStopped {
  state: Exclude<AutomationState, 'active'>;
  pauseReason: AutomationPauseReason | null;
  since: string;
  fromDay: string;
}

export async function storageChargeStopped(
  dbAdapter: DBAdapter,
  automationId: RealmResourceIdentifier,
): Promise<StorageChargeStopped | null> {
  let [latest] = (await query(dbAdapter, [
    `WITH history AS (
       SELECT id, state, pause_reason, changed_at FROM automation_state_changes
       WHERE automation_id =`,
    param(automationId),
    `),
     last_active AS (
       SELECT changed_at, id FROM history WHERE state = 'active'
       ORDER BY changed_at DESC, id DESC LIMIT 1)
     SELECT latest.state, latest.pause_reason,
       -- The first change after the automation last became active.
       (SELECT MIN(s.changed_at) FROM history s
        WHERE NOT EXISTS (SELECT 1 FROM last_active l
          WHERE (l.changed_at, l.id) >= (s.changed_at, s.id))) AS since,
       EXISTS (SELECT 1 FROM last_active) AS was_active
     FROM (SELECT * FROM history ORDER BY changed_at DESC, id DESC LIMIT 1)
       AS latest`,
  ])) as unknown as {
    state: AutomationState;
    pause_reason: AutomationPauseReason | null;
    since: string | Date | null;
    was_active: boolean;
  }[];
  if (!latest || latest.state === 'active' || latest.since == null) {
    return null;
  }
  let since = new Date(latest.since).toISOString();
  let sinceDay = since.slice(0, 10);
  let atMidnight = since === `${sinceDay}T00:00:00.000Z`;
  return {
    state: latest.state,
    pauseReason: latest.pause_reason,
    since,
    fromDay: latest.was_active && !atMidnight ? addDays(sinceDay, 1) : sinceDay,
  };
}

// The UTC day before `now`, as YYYY-MM-DD: the most recent day that has ended.
export function previousUTCDay(now: Date = new Date()): string {
  return addDays(now.toISOString().slice(0, 10), -1);
}

function addDays(day: string, count: number): string {
  let date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
