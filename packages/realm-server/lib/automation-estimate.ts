import { CREDITS_PER_USD } from '@cardstack/runtime-common';
import {
  computeAutomationSchedule,
  countCronTimes,
  type AutomationTrigger,
  type TriggerRunState,
} from '@cardstack/runtime-common/automation-schedule';
import { BYTES_PER_GB, type Pricing } from './pricing.ts';

// What switching an automation on is likely to cost a month, shown on the
// switch-on screen beside the monthly cap it asks for.
//
// Each run is priced at the most its caps let it spend on compute, network
// and AI, the charges a run's caps bound. Two charges the payer also pays
// are outside the estimate, listed in `uncountedChargeKinds`: the indexing a
// run's writes cause, which no cap bounds, and the daily storage of the files
// its runs create, which depends on what the realm keeps rather than on any
// one run.
//
// The runs counted in a month are:
//
// * each cron trigger's runs in an average month, and for a bounded trigger
//   (`until` or `count`) no more than the runs it has left;
// * one run for each `once` trigger that hasn't fired.
//
// A webhook trigger fires on deliveries no schedule predicts, so its runs
// aren't counted; the result lists it for the screen to say so. Recent
// Preview cost is reported beside the estimate, not added to it: Preview is
// charged to whoever clicks, not to the payer.

const SECONDS_PER_DAY = 24 * 60 * 60;
// Four Gregorian years hold one February 29 (outside the skipped century
// leap days), so an expression that names it gets its true share.
const FOUR_YEARS_SECONDS = 1461 * SECONDS_PER_DAY;
const MONTHS_IN_FOUR_YEARS = 48;
const AVERAGE_MONTH_SECONDS = FOUR_YEARS_SECONDS / MONTHS_IN_FOUR_YEARS;
// A trigger that fires at least this often in the coming month is counted at
// that month's runs, which costs one month's scan. Rarer triggers have few
// times to count, so they are counted over four years and averaged.
const FREQUENT_RUNS_PER_MONTH = 28;

// Charge kinds a run can incur that the estimate doesn't price.
export const UNCOUNTED_CHARGE_KINDS = ['run_indexing', 'storage'] as const;

// The caps that bound what one run can cost. A run's compute is bounded by
// its time limit, its network by the bytes its `callApi` calls may download,
// and its AI by its AI spending cap (ADR 029 §1.5), which is already in
// credits.
export interface RunCostCaps {
  seconds: number;
  responseBytes: number;
  aiCredits: number;
}

// The most one run's compute, network and AI can cost under its caps, in
// credits, before rounding. This is the one place that ceiling is computed:
// an automation's minimum balance (ADR 029 §1.5, "the most one of its runs
// can cost") is meant to come from `runCostCeiling` too, so the balance a run
// is admitted against and the estimate shown at switch-on can't drift apart.
export interface RunCostCeiling {
  computeCredits: number;
  networkCredits: number;
  aiCredits: number;
  totalCredits: number;
}

export function runCostCeiling(
  caps: RunCostCaps,
  pricing: Pricing,
): RunCostCeiling {
  let { margin, usdPerDownloadedGb } = pricing.values;
  let computeCredits =
    caps.seconds * pricing.prerenderTabUsdPerSecond * margin * CREDITS_PER_USD;
  let networkCredits =
    (caps.responseBytes / BYTES_PER_GB) *
    usdPerDownloadedGb *
    margin *
    CREDITS_PER_USD;
  // AI carries no margin (ADR 029 §1.1), and the cap is already in credits.
  let aiCredits = caps.aiCredits;
  return {
    computeCredits,
    networkCredits,
    aiCredits,
    totalCredits: computeCredits + networkCredits + aiCredits,
  };
}

// A cron expression's runs in an average month from `now`. A frequent one is
// counted over the coming month; a rarer one over the coming four years,
// over 48, so a monthly expression counts 1, a yearly one 1/12 and one that
// names February 29 1/48.
export function cronRunsPerMonth(
  expression: string,
  timeZone: string,
  now: number,
): number {
  let month = countCronTimes(
    expression,
    timeZone,
    now,
    now + AVERAGE_MONTH_SECONDS,
  );
  if (month >= FREQUENT_RUNS_PER_MONTH) {
    return month;
  }
  return (
    countCronTimes(expression, timeZone, now, now + FOUR_YEARS_SECONDS) /
    MONTHS_IN_FOUR_YEARS
  );
}

export type TriggerEstimate =
  | {
      label: string;
      kind: 'cron';
      // Runs counted in a month: the expression's runs in an average month,
      // and for a bounded trigger no more than `remainingRuns`.
      runsPerMonth: number;
      // For a bounded trigger (`until` or `count`): runs left, the next one
      // included.
      remainingRuns?: number;
      // The schedule library's count stopped at its limit, so there are at
      // least `remainingRuns`.
      remainingRunsAtLeast?: boolean;
    }
  | {
      label: string;
      kind: 'once';
      // 1 until it fires, then 0.
      remainingRuns: number;
    }
  | {
      label: string;
      kind: 'webhook';
    }
  | {
      label: string;
      kind: 'cron' | 'once';
      // An invalid expression or time zone; the trigger never runs, so it
      // adds nothing.
      error: string;
    };

export interface AutomationEstimateInput {
  triggers: readonly AutomationTrigger[];
  caps: RunCostCaps;
  pricing: Pricing;
  // Unix seconds.
  now: number;
  // Unix seconds: when the automation was switched on, or resumed. Defaults
  // to `now`, which is the switch-on screen's case.
  since?: number;
  // The automation row's per-trigger run counts, keyed by label, when the
  // automation is already on.
  runState?: Readonly<Record<string, TriggerRunState | undefined>>;
  // Credits the person's recent Preview runs of this automation cost.
  recentPreviewCredits?: number;
}

export interface AutomationEstimate {
  // The pricing version the estimate was priced at.
  pricingVersion: string;
  perRun: RunCostCeiling;
  // Runs in a month across cron triggers without `until` or `count`.
  unboundedRunsPerMonth: number;
  // Runs in a month across cron triggers with `until` or `count`.
  boundedRunsPerMonth: number;
  // `once` triggers that haven't fired.
  onceRuns: number;
  // The per-run ceiling times every run counted, rounded up to whole
  // credits.
  credits: number;
  // Charges the payer can incur that `credits` doesn't include.
  uncountedChargeKinds: readonly (typeof UNCOUNTED_CHARGE_KINDS)[number][];
  // Labels of webhook triggers, whose runs the estimate doesn't count.
  webhookTriggers: string[];
  triggers: TriggerEstimate[];
  recentPreviewCredits?: number;
}

export function estimateAutomationCost(
  input: AutomationEstimateInput,
): AutomationEstimate {
  let { triggers, now, pricing } = input;
  let schedule = computeAutomationSchedule({
    triggers,
    since: input.since ?? now,
    now,
    runState: input.runState,
    includeRemainingRuns: true,
  });

  let estimates: TriggerEstimate[] = [];
  let unboundedRunsPerMonth = 0;
  let boundedRunsPerMonth = 0;
  let onceRuns = 0;
  let webhookTriggers: string[] = [];

  triggers.forEach((trigger, index) => {
    let scheduled = schedule.triggers[index];
    let { label } = trigger;
    if (trigger.kind === 'webhook') {
      webhookTriggers.push(label);
      estimates.push({ label, kind: 'webhook' });
      return;
    }
    if (scheduled.error !== undefined) {
      estimates.push({ label, kind: trigger.kind, error: scheduled.error });
      return;
    }
    if (trigger.kind === 'once') {
      let remainingRuns = scheduled.remainingRuns ?? 0;
      onceRuns += remainingRuns;
      estimates.push({ label, kind: 'once', remainingRuns });
      return;
    }
    // The schedule counts runs left for every bounded trigger, and only for
    // those.
    let { remainingRuns, remainingRunsAtLeast } = scheduled;
    let runsPerMonth =
      remainingRuns === 0
        ? 0
        : cronRunsPerMonth(trigger.expression, trigger.timeZone, now);
    if (remainingRuns === undefined) {
      unboundedRunsPerMonth += runsPerMonth;
      estimates.push({ label, kind: 'cron', runsPerMonth });
      return;
    }
    runsPerMonth = Math.min(runsPerMonth, remainingRuns);
    boundedRunsPerMonth += runsPerMonth;
    estimates.push({
      label,
      kind: 'cron',
      runsPerMonth,
      remainingRuns,
      remainingRunsAtLeast: remainingRunsAtLeast ?? false,
    });
  });

  let perRun = runCostCeiling(input.caps, pricing);
  let runs = unboundedRunsPerMonth + boundedRunsPerMonth + onceRuns;
  let estimate: AutomationEstimate = {
    pricingVersion: pricing.version,
    perRun,
    unboundedRunsPerMonth,
    boundedRunsPerMonth,
    onceRuns,
    credits: Math.ceil(perRun.totalCredits * runs),
    uncountedChargeKinds: UNCOUNTED_CHARGE_KINDS,
    webhookTriggers,
    triggers: estimates,
  };
  if (input.recentPreviewCredits !== undefined) {
    estimate.recentPreviewCredits = input.recentPreviewCredits;
  }
  return estimate;
}
