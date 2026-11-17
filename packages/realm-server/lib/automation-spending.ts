import {
  getUserByMatrixUserId,
  sumUpAvailableCredits,
} from '@cardstack/billing/billing-queries';
import {
  MANUAL_RUN_TRIGGER,
  type AutomationCaps,
} from '@cardstack/runtime-common/automation-declaration';
import type {
  AdmissionRefusal,
  AutomationAdmissionChecks,
  SpendingRefusalReason,
} from '@cardstack/runtime-common/automation-admission';
import {
  creditsHeldByRunsInFlight,
  holdAutomationRunCredits,
  dbAdapterQuerier,
  param,
  type AutomationRun,
  type DBAdapter,
  type Querier,
} from '@cardstack/runtime-common';
import type { AutomationRow } from '@cardstack/runtime-common/automations';
import { runCostCeiling } from './automation-estimate.ts';
import { currentPricing, type Pricing } from './pricing.ts';

// An automation run's spending check, the last step of its admission (ADR 029
// §1.5). Under the cost lock of the person the run acts as, in order:
//
// 1. The run's identity's balance. Their balance, less what their other runs
//    in flight hold, must be at least the run's minimum balance: the most one
//    run can cost under its caps (`runCostCeiling`, the same per-run cost the
//    switch-on estimate shows), never below the configured floor. The
//    minimum covers the whole run because `spendCredits` charges only what
//    the balance holds. It comes first, so a refusal for a cap means the
//    balance was enough, and admission can tell the automation is no longer
//    waiting for credits.
// 2. The automation's credit caps. For a run of the automation's own (a
//    trigger's or a batch's follow-up, not a Preview or a Run now, which are
//    charged to whoever clicked), what the automation was charged this UTC
//    day and this UTC month, plus what its other runs in flight hold, must be
//    under the daily and monthly caps its payer agreed to (the caps
//    snapshot). Each cap covers every charge kind that names the automation:
//    its runs' compute, network, indexing and AI, its batches and its
//    storage. A run admitted under a cap can take the automation past it by
//    at most what that run costs.
// 3. The hold. The run's cost ceiling is recorded on its row
//    (`holdAutomationRunCredits`), so the next run's check, under the same
//    lock, counts it. Two runs can't both pass on one run's worth of balance.
//
// The ceiling is priced from the caps snapshot where the automation is
// switched on, and from the run's caps otherwise. It leaves out the indexing
// a run's writes cause, as ADR 029 §1.5 requires.

export interface AutomationSpendingOptions {
  dbAdapter: DBAdapter;
  // Read on each check, so a process whose pricing check failed admits no
  // run (ADR 029 §1.3).
  pricing?: () => Pricing | undefined;
  // Unix seconds; the day and month a cap counts are the UTC ones this falls
  // in. The current time when absent.
  now?: () => number;
}

export function buildAdmitSpending({
  dbAdapter,
  pricing = currentPricing,
  now = () => Math.floor(Date.now() / 1000),
}: AutomationSpendingOptions): NonNullable<
  AutomationAdmissionChecks['admitSpending']
> {
  return async ({ run, automation, caps, kind }) => {
    let prices = pricing();
    if (!prices) {
      return refuse(
        'pricing-unavailable',
        'This worker has no prices, so it admits no automation run',
      );
    }
    let ceiling = Math.ceil(
      runCostCeiling(ceilingCaps(caps, automation), prices).totalCredits,
    );
    let minimum = Math.max(ceiling, prices.values.minimumBalanceFloorCredits);
    let user = await getUserByMatrixUserId(dbAdapter, run.actsAs);
    let querier = dbAdapterQuerier(dbAdapter);

    return await dbAdapter.withUserCostLock(run.actsAs, async () => {
      let balance = user ? await sumUpAvailableCredits(dbAdapter, user.id) : 0;
      let held = await creditsHeldByRunsInFlight(querier, {
        actsAs: run.actsAs,
        excludeRunId: run.id,
      });
      if (balance - held < minimum) {
        // The message reaches the run's row and log, which every direct
        // writer of the realm reads, so it never says what the person holds.
        return refuse(
          'insufficient-credits',
          `The credits available to ${run.actsAs}, after their other automation runs in flight, are below this run's minimum balance of ${minimum} credits`,
        );
      }
      if (kind !== 'manual' && automation) {
        let capRefusal = await checkCreditCaps(querier, run, automation, now());
        if (capRefusal) {
          return capRefusal;
        }
      }
      if (run.attempt !== null) {
        await holdAutomationRunCredits(dbAdapter, run.id, run.attempt, ceiling);
      }
      return undefined;
    });
  };
}

// The caps one run's cost ceiling is priced from: the payer's caps snapshot
// once the automation is switched on, falling back to the run's caps for a
// cap the snapshot predates; the run's caps when it has no row.
function ceilingCaps(
  caps: AutomationCaps,
  automation: AutomationRow | undefined,
): Pick<AutomationCaps, 'seconds' | 'responseBytes' | 'aiCredits'> {
  let snapshot = automation?.capsSnapshot;
  return {
    seconds: snapshot?.seconds ?? caps.seconds,
    responseBytes: snapshot?.responseBytes ?? caps.responseBytes,
    aiCredits: snapshot?.aiCredits ?? caps.aiCredits,
  };
}

async function checkCreditCaps(
  querier: Querier,
  run: AutomationRun,
  automation: AutomationRow,
  nowSeconds: number,
): Promise<AdmissionRefusal | undefined> {
  let { dailyCredits, monthlyCredits } = automation.capsSnapshot;
  if (typeof dailyCredits !== 'number' && typeof monthlyCredits !== 'number') {
    return undefined;
  }
  let held = await creditsHeldByRunsInFlight(querier, {
    automationId: run.automationId,
    excludeRunId: run.id,
  });
  let today = new Date(nowSeconds * 1000);
  let caps: [SpendingRefusalReason, string, number | null, number][] = [
    [
      'daily-credit-cap-reached',
      'today (UTC)',
      dailyCredits,
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate(),
      ) / 1000,
    ],
    [
      'monthly-credit-cap-reached',
      'this month (UTC)',
      monthlyCredits,
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1) / 1000,
    ],
  ];
  for (let [reason, period, cap, since] of caps) {
    if (typeof cap !== 'number') {
      continue;
    }
    let spent = await automationCreditsSince(querier, run.automationId, since);
    if (spent + held >= cap) {
      return refuse(
        reason,
        `The automation was charged ${spent} credits ${period}, and its other runs in flight hold ${held}, which reaches its cap of ${cap}`,
      );
    }
  }
  return undefined;
}

// How long before a charge the usage it pays for can have started. A run's
// own charges land within its time limit and its index pass of its end; a
// batch is billed when it ends, at most `batchDeadlineMinutes` (1,440) after
// its run submitted it; a day's storage is charged after the day ends. Two
// days covers each, so the charges since a day or month began come from runs
// created, and storage days that began, at most this long before it.
const CHARGE_LAG_SECONDS = 2 * 24 * 60 * 60;

// What the automation was charged since `since` (unix seconds), across every
// charge kind that names it: everything its runs were charged, leaving out
// Previews and Run nows, plus its storage. It reads only the automation's
// recent runs and storage days, each through an index (the runs'
// `(automation_id, created_at)` index then the ledger's `run_id` index, and
// the ledger's charge-once index for storage), so it grows with neither the
// automation's history nor the ledger.
async function automationCreditsSince(
  querier: Querier,
  automationId: string,
  since: number,
): Promise<number> {
  let earliest = since - CHARGE_LAG_SECONDS;
  let [runs] = await querier([
    'SELECT COALESCE(-SUM(l.credit_amount), 0) AS spent',
    'FROM automation_runs r JOIN credits_ledger l ON l.run_id = r.id',
    'WHERE r.automation_id =',
    param(automationId),
    'AND r.created_at >= to_timestamp(',
    param(earliest),
    ') AND r.trigger <>',
    param(MANUAL_RUN_TRIGGER),
    'AND l.created_at >=',
    param(since),
  ]);
  // The literal kind and the null references match the charge-once index's
  // partial predicate and leading columns, so the planner can use it.
  let [storage] = await querier([
    'SELECT COALESCE(-SUM(l.credit_amount), 0) AS spent FROM credits_ledger l',
    "WHERE l.charge_kind = 'storage' AND l.run_id IS NULL AND l.batch_id IS NULL",
    'AND l.automation_id =',
    param(automationId),
    'AND l.charge_day >= to_timestamp(',
    param(earliest),
    ')::date AND l.created_at >=',
    param(since),
  ]);
  return Number(runs?.spent ?? 0) + Number(storage?.spent ?? 0);
}

function refuse(
  reason: SpendingRefusalReason,
  message: string,
): AdmissionRefusal {
  return { reason, message };
}
