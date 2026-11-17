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
// 1. The automation's credit caps. For a run of the automation's own (a
//    trigger's or a batch's follow-up, not a Preview or a Run now, which are
//    charged to whoever clicked), what the automation was charged this UTC
//    day and this UTC month, plus what its other runs in flight hold, must be
//    under the daily and monthly caps its payer agreed to (the caps
//    snapshot). Each cap covers every charge kind that names the automation:
//    its runs' compute, network, indexing and AI, its batches and its
//    storage. A run admitted under a cap can take the automation past it by
//    at most what that run costs.
// 2. The run's identity's balance. Their balance, less what their other runs
//    in flight hold, must be at least the run's minimum balance: the most one
//    run can cost under its caps (`runCostCeiling`, the same per-run cost the
//    switch-on estimate shows), never below the configured floor. The
//    minimum covers the whole run because `spendCredits` charges only what
//    the balance holds.
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
      if (kind !== 'manual' && automation) {
        let capRefusal = await checkCreditCaps(querier, run, automation, now());
        if (capRefusal) {
          return capRefusal;
        }
      }
      let balance = user ? await sumUpAvailableCredits(dbAdapter, user.id) : 0;
      let held = await creditsHeldByRunsInFlight(querier, {
        actsAs: run.actsAs,
        excludeRunId: run.id,
      });
      if (balance - held < minimum) {
        return refuse(
          'insufficient-credits',
          `${run.actsAs} has ${balance} credits, ${held} of them held by other automation runs in flight, and the run needs ${minimum} available: the most it can cost under its caps${minimum > ceiling ? ', raised to the minimum balance' : ''}`,
        );
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

// What the automation was charged since `since` (unix seconds), across every
// charge kind that names it: its storage by the automation, and everything
// else by its runs, leaving out Previews and Run nows.
async function automationCreditsSince(
  querier: Querier,
  automationId: string,
  since: number,
): Promise<number> {
  let [row] = await querier([
    'SELECT COALESCE(-SUM(l.credit_amount), 0) AS spent FROM credits_ledger l',
    'WHERE l.created_at >=',
    param(since),
    "AND ((l.charge_kind = 'storage' AND l.automation_id =",
    param(automationId),
    ') OR l.run_id IN (SELECT r.id FROM automation_runs r WHERE r.automation_id =',
    param(automationId),
    'AND r.trigger <>',
    param(MANUAL_RUN_TRIGGER),
    '))',
  ]);
  return Number(row?.spent ?? 0);
}

function refuse(
  reason: SpendingRefusalReason,
  message: string,
): AdmissionRefusal {
  return { reason, message };
}
