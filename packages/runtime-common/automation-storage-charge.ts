// The daily storage charge (ADR 029): each switched-on automation's payer
// pays for the files its runs created, at the file storage rate, and for
// their rows in the index, at the database storage rate, for every day the
// automation is switched on.
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
// Removing an automation deletes its `automations` row, so it is no longer
// measured or charged. Switching it on again starts from that day.

import { getAutomationStorage } from './automation-files.ts';
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
  | 'not-due';

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
         AS last_charged_day
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

// The UTC day before `now`, as YYYY-MM-DD: the most recent day that has ended.
export function previousUTCDay(now: Date = new Date()): string {
  return addDays(now.toISOString().slice(0, 10), -1);
}

function addDays(day: string, count: number): string {
  let date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
