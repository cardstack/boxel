// What an automation was charged over a span of time, across every charge
// kind that names the automation. The credit caps an automation's runs are
// admitted under count it (the realm server's spending check), and the
// realm's automation list shows it as the automation's spend this month, so
// the figure a direct writer reads is the one the monthly cap compares.

import { MANUAL_RUN_TRIGGER } from './automation-declaration.ts';
import {
  addExplicitParens,
  param,
  separatedByCommas,
  type Expression,
  type Querier,
} from './expression.ts';

// How long before a charge the usage it pays for can have started. A run's
// own charges land within its time limit and its index pass of its end; a
// batch is billed when it ends, at most `batchDeadlineMinutes` (1,440) after
// its run submitted it; a day's storage is charged after the day ends. Two
// days covers each, so the charges since a day or month began come from runs
// created, and storage days that began, at most this long before it.
const CHARGE_LAG_SECONDS = 2 * 24 * 60 * 60;

// What the automation was charged since `since` (unix seconds), across every
// charge kind that names it: everything its runs were charged, leaving out
// Previews and Run nows, plus its storage.
export async function automationCreditsSince(
  querier: Querier,
  automationId: string,
  since: number,
): Promise<number> {
  return (
    (await automationCreditsSinceFor(querier, [automationId], since)).get(
      automationId,
    ) ?? 0
  );
}

// `automationCreditsSince` for each of `automationIds` at once, keyed by
// automation id; an automation charged nothing is absent. It reads only the
// automations' recent runs and storage days, each through an index (the
// runs' `(automation_id, created_at)` index then the ledger's `run_id` index,
// and the ledger's charge-once index for storage), so it grows with neither
// the automations' history nor the ledger.
export async function automationCreditsSinceFor(
  querier: Querier,
  automationIds: string[],
  since: number,
): Promise<Map<string, number>> {
  let spent = new Map<string, number>();
  if (automationIds.length === 0) {
    return spent;
  }
  let ids = addExplicitParens(
    separatedByCommas(automationIds.map((id) => [param(id)])),
  ) as Expression;
  let earliest = since - CHARGE_LAG_SECONDS;
  let runs = (await querier([
    'SELECT r.automation_id, COALESCE(-SUM(l.credit_amount), 0) AS spent',
    'FROM automation_runs r JOIN credits_ledger l ON l.run_id = r.id',
    'WHERE r.automation_id IN',
    ...ids,
    'AND r.created_at >= to_timestamp(',
    param(earliest),
    ') AND r.trigger <>',
    param(MANUAL_RUN_TRIGGER),
    'AND l.created_at >=',
    param(since),
    'GROUP BY r.automation_id',
  ] as Expression)) as { automation_id: string; spent: unknown }[];
  // The literal kind and the null references match the charge-once index's
  // partial predicate and leading columns, so the planner can use it.
  let storage = (await querier([
    'SELECT l.automation_id, COALESCE(-SUM(l.credit_amount), 0) AS spent FROM credits_ledger l',
    "WHERE l.charge_kind = 'storage' AND l.run_id IS NULL AND l.batch_id IS NULL",
    'AND l.automation_id IN',
    ...ids,
    'AND l.charge_day >= to_timestamp(',
    param(earliest),
    ')::date AND l.created_at >=',
    param(since),
    'GROUP BY l.automation_id',
  ] as Expression)) as { automation_id: string; spent: unknown }[];
  for (let row of [...runs, ...storage]) {
    spent.set(
      row.automation_id,
      (spent.get(row.automation_id) ?? 0) + Number(row.spent ?? 0),
    );
  }
  return spent;
}

// Unix seconds: the start of the UTC day `now` (unix seconds) falls in, the
// day a daily credit cap counts.
export function utcDayStart(now: number): number {
  let date = new Date(now * 1000);
  return (
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) /
    1000
  );
}

// Unix seconds: the start of the UTC month `now` (unix seconds) falls in, the
// month a monthly credit cap counts.
export function utcMonthStart(now: number): number {
  let date = new Date(now * 1000);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000;
}
