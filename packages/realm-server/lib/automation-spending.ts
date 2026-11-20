import {
  getUserByMatrixUserId,
  sumUpAvailableCredits,
} from '@cardstack/billing/billing-queries';
import type { AutomationCaps } from '@cardstack/runtime-common/automation-declaration';
import type {
  AdmissionRefusal,
  AutomationAdmissionChecks,
  SpendingRefusalReason,
} from '@cardstack/runtime-common/automation-admission';
import {
  creditsHeldByRunsInFlight,
  holdAutomationRunCredits,
  dbAdapterQuerier,
  type AutomationRun,
  type DBAdapter,
  type Querier,
  type RealmResourceIdentifier,
} from '@cardstack/runtime-common';
import type { AutomationRow } from '@cardstack/runtime-common/automations';
import {
  automationCreditsSince,
  utcDayStart,
  utcMonthStart,
} from '@cardstack/runtime-common/automation-spend';
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
//
// A resume asks the same of the person it would make the payer
// (`buildAdmitPayerSpending`), with the caps they would agree to and no run
// to hold against, so an automation never goes active under a payer whose
// first run this check would refuse.

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
  return async ({ run, automation, caps, kind }) =>
    await spendingRefusal(dbAdapter, {
      prices: pricing(),
      now: now(),
      actsAs: run.actsAs,
      ceilingCaps: ceilingCaps(caps, automation),
      creditCaps:
        kind !== 'manual' && automation
          ? {
              automationId: run.automationId,
              dailyCredits: automation.capsSnapshot.dailyCredits,
              monthlyCredits: automation.capsSnapshot.monthlyCredits,
            }
          : undefined,
      run,
      hold: async (ceiling) => {
        if (run.attempt !== null) {
          await holdAutomationRunCredits(
            dbAdapter,
            run.id,
            run.attempt,
            ceiling,
          );
        }
      },
    });
}

// The spending check a resume makes for the person it would make the
// automation's payer: their balance against one run's minimum balance at the
// caps the card sets, which they would agree to, and what the automation was
// charged this UTC day and month against those caps' daily and monthly
// credits. Nothing is held, since no run is admitted.
export function buildAdmitPayerSpending({
  dbAdapter,
  pricing = currentPricing,
  now = () => Math.floor(Date.now() / 1000),
}: AutomationSpendingOptions): (args: {
  payer: string;
  automationId: RealmResourceIdentifier;
  caps: AutomationCaps;
}) => Promise<AdmissionRefusal | undefined> {
  return async ({ payer, automationId, caps }) =>
    await spendingRefusal(dbAdapter, {
      prices: pricing(),
      now: now(),
      actsAs: payer,
      ceilingCaps: caps,
      creditCaps: {
        automationId,
        dailyCredits: caps.dailyCredits,
        monthlyCredits: caps.monthlyCredits,
      },
    });
}

// The check both share, under `actsAs`'s cost lock: the balance, then the
// credit caps when `creditCaps` names them, then `hold`, which is given the
// run's ceiling once both pass. `run`, when there is one, is left out of
// what runs in flight hold.
async function spendingRefusal(
  dbAdapter: DBAdapter,
  {
    prices,
    now,
    actsAs,
    ceilingCaps,
    creditCaps,
    run,
    hold,
  }: {
    prices: Pricing | undefined;
    now: number;
    actsAs: string;
    ceilingCaps: Pick<
      AutomationCaps,
      'seconds' | 'responseBytes' | 'aiCredits'
    >;
    creditCaps:
      | {
          automationId: RealmResourceIdentifier;
          dailyCredits: number | null | undefined;
          monthlyCredits: number | null | undefined;
        }
      | undefined;
    run?: AutomationRun;
    hold?: (ceiling: number) => Promise<void>;
  },
): Promise<AdmissionRefusal | undefined> {
  if (!prices) {
    return refuse(
      'pricing-unavailable',
      'This server has no prices, so it admits no automation run',
    );
  }
  let ceiling = Math.ceil(runCostCeiling(ceilingCaps, prices).totalCredits);
  let minimum = Math.max(ceiling, prices.values.minimumBalanceFloorCredits);
  let user = await getUserByMatrixUserId(dbAdapter, actsAs);
  let querier = dbAdapterQuerier(dbAdapter);

  return await dbAdapter.withUserCostLock(actsAs, async () => {
    let balance = user ? await sumUpAvailableCredits(dbAdapter, user.id) : 0;
    let held = await creditsHeldByRunsInFlight(querier, {
      actsAs,
      excludeRunId: run?.id,
    });
    if (balance - held < minimum) {
      // The message reaches the run's row and log, which every direct
      // writer of the realm reads, so it never says what the person holds.
      return refuse(
        'insufficient-credits',
        `The credits available to ${actsAs}, after their other automation runs in flight, are below ${run ? "this run's" : "one run's"} minimum balance of ${minimum} credits`,
      );
    }
    if (creditCaps) {
      let capRefusal = await checkCreditCaps(querier, creditCaps, {
        excludeRunId: run?.id,
        now,
      });
      if (capRefusal) {
        return capRefusal;
      }
    }
    await hold?.(ceiling);
    return undefined;
  });
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
  {
    automationId,
    dailyCredits,
    monthlyCredits,
  }: {
    automationId: RealmResourceIdentifier;
    dailyCredits: number | null | undefined;
    monthlyCredits: number | null | undefined;
  },
  { excludeRunId, now }: { excludeRunId: string | undefined; now: number },
): Promise<AdmissionRefusal | undefined> {
  if (typeof dailyCredits !== 'number' && typeof monthlyCredits !== 'number') {
    return undefined;
  }
  let held = await creditsHeldByRunsInFlight(querier, {
    automationId,
    excludeRunId,
  });
  let caps: [
    SpendingRefusalReason,
    string,
    number | null | undefined,
    number,
  ][] = [
    ['daily-credit-cap-reached', 'today (UTC)', dailyCredits, utcDayStart(now)],
    [
      'monthly-credit-cap-reached',
      'this month (UTC)',
      monthlyCredits,
      utcMonthStart(now),
    ],
  ];
  for (let [reason, period, cap, since] of caps) {
    if (typeof cap !== 'number') {
      continue;
    }
    let spent = await automationCreditsSince(querier, automationId, since);
    if (spent + held >= cap) {
      return refuse(
        reason,
        `The automation was charged ${spent} credits ${period}, and its other runs in flight hold ${held}, which reaches its cap of ${cap}`,
      );
    }
  }
  return undefined;
}

function refuse(
  reason: SpendingRefusalReason,
  message: string,
): AdmissionRefusal {
  return { reason, message };
}
