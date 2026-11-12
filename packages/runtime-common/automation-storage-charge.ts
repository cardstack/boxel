// The daily storage charge (ADR 029): each switched-on automation's payer
// pays for the files its runs created, at the file storage rate, and for
// those cards' rows in the index, at the database storage rate, for every day
// the automation is switched on. The files are the automation's
// `automation_files` rows that still exist (see `getAutomationStorage`),
// measured when the charge is made.
//
// A day of a few small files costs a tiny fraction of a credit, and credits
// are whole numbers, so a charge covers every day since the automation's last
// storage charge (or since it was switched on), and is written only once that
// span costs at least a whole credit. The charge is named by its last day, so
// an automation is charged at most once a day, and a retried job writes
// nothing twice. Its usage records the GB-months of the whole span.
//
// Removing an automation deletes its `automations` row, so it is no longer
// charged. Switching it on again starts a new span from that day.

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
       (SELECT to_char(MAX(l.charge_day), 'YYYY-MM-DD') FROM credits_ledger l
        WHERE l.charge_kind = 'storage' AND l.automation_id = a.automation_id)
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
  let months = (daysBetween(firstDay, day) + 1) / DAYS_PER_AVERAGE_MONTH;
  let storage = await getAutomationStorage(dbAdapter, automationId);
  let fileStorageGbMonths = (storage.fileBytes / BYTES_PER_GB) * months;
  let databaseStorageGbMonths = (storage.indexBytes / BYTES_PER_GB) * months;
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

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}
