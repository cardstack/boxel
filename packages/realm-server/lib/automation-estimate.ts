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
// Each run is counted at the most its caps let it cost, so the estimate is a
// ceiling for the runs it counts, not a forecast of typical spend. The runs
// counted are:
//
// * each unbounded cron trigger's runs in an average month;
// * every run left on each bounded trigger: a cron trigger with `until` or
//   `count`, and a `once` trigger that hasn't fired;
//
// so a bounded schedule's remaining runs are counted in full, even when they
// span more than a month. A webhook trigger fires on deliveries no schedule
// predicts, so its runs aren't counted; the result lists it for the screen to
// say so. Recent Preview cost is reported beside the estimate, not added to
// it: Preview is charged to whoever clicks, not to the payer.

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
const MONTHS_PER_YEAR = 12;

// The caps that bound what one run can cost. A run's compute is bounded by
// its time limit, its network by the bytes its `callApi` calls may download,
// and its AI by its AI spending cap (ADR 029 §1.5), which is already in
// credits.
export interface RunCostCaps {
  seconds: number;
  responseBytes: number;
  aiCredits: number;
}

// The most one run can cost under its caps, in credits, before rounding.
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

export type TriggerEstimate =
  | {
      label: string;
      kind: 'cron';
      bounded: false;
      // Runs in an average month: its runs in the year from `now`, over 12,
      // so a monthly or yearly expression counts its share and daylight
      // saving's extra and missing hours even out.
      runsPerMonth: number;
    }
  | {
      label: string;
      kind: 'cron' | 'once';
      bounded: true;
      // Runs left, the next one included.
      remainingRuns: number;
      // The count stopped at the schedule library's limit, so there are at
      // least `remainingRuns`.
      remainingRunsAtLeast: boolean;
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
  // Runs per average month across unbounded cron triggers.
  unboundedRunsPerMonth: number;
  // Runs left across bounded cron triggers.
  boundedCronRuns: number;
  // `once` triggers that haven't fired.
  onceRuns: number;
  // A bounded trigger's count stopped at the limit, so the estimate is a
  // lower bound.
  runsAtLeast: boolean;
  // The per-run ceiling times every run counted, rounded up to whole
  // credits.
  credits: number;
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
  let boundedCronRuns = 0;
  let onceRuns = 0;
  let runsAtLeast = false;
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
    // The schedule counts runs left for every bounded trigger, so a cron
    // trigger without them is unbounded.
    if (trigger.kind === 'cron' && scheduled.remainingRuns === undefined) {
      let runsPerMonth =
        countCronTimes(
          trigger.expression,
          trigger.timeZone,
          now,
          now + SECONDS_PER_YEAR,
        ) / MONTHS_PER_YEAR;
      unboundedRunsPerMonth += runsPerMonth;
      estimates.push({ label, kind: 'cron', bounded: false, runsPerMonth });
      return;
    }
    let remainingRuns = scheduled.remainingRuns ?? 0;
    let remainingRunsAtLeast = scheduled.remainingRunsAtLeast ?? false;
    if (trigger.kind === 'once') {
      onceRuns += remainingRuns;
    } else {
      boundedCronRuns += remainingRuns;
    }
    runsAtLeast ||= remainingRunsAtLeast;
    estimates.push({
      label,
      kind: trigger.kind,
      bounded: true,
      remainingRuns,
      remainingRunsAtLeast,
    });
  });

  let perRun = runCostCeiling(input.caps, pricing);
  let runs = unboundedRunsPerMonth + boundedCronRuns + onceRuns;
  let estimate: AutomationEstimate = {
    pricingVersion: pricing.version,
    perRun,
    unboundedRunsPerMonth,
    boundedCronRuns,
    onceRuns,
    runsAtLeast,
    credits: Math.ceil(perRun.totalCredits * runs),
    webhookTriggers,
    triggers: estimates,
  };
  if (input.recentPreviewCredits !== undefined) {
    estimate.recentPreviewCredits = input.recentPreviewCredits;
  }
  return estimate;
}
