import { createHash } from 'node:crypto';
import * as Sentry from '@sentry/node';
import { logger } from '@cardstack/runtime-common';

// The prices metered usage is charged at (ADR 029). Every value is
// deployment configuration read from the process environment. The code holds
// no prices and no fallbacks: one missing or malformed value, or a margin
// below 1, fails the check for the whole set, and a process whose check
// failed has no prices to charge with. Callers that admit runs or submit
// batches treat `currentPricing()` returning undefined as "admit nothing"
// (ADR 029 §1.3).
//
// The rates are what the hosting provider charges for one unit of a
// resource. Compute rates are per task family, because the families can run
// on different architectures at different rates, and the task shapes spread
// a task's cost over the tabs or processes that share it.

const log = logger('pricing');

export const PRICING_VARIABLES = {
  prerenderUsdPerVcpuHour: 'PRICING_PRERENDER_USD_PER_VCPU_HOUR',
  prerenderUsdPerMemoryGbHour: 'PRICING_PRERENDER_USD_PER_MEMORY_GB_HOUR',
  prerenderTaskVcpus: 'PRICING_PRERENDER_TASK_VCPUS',
  prerenderTaskMemoryGb: 'PRICING_PRERENDER_TASK_MEMORY_GB',
  prerenderTaskTabs: 'PRICING_PRERENDER_TASK_TABS',
  workerUsdPerVcpuHour: 'PRICING_WORKER_USD_PER_VCPU_HOUR',
  workerUsdPerMemoryGbHour: 'PRICING_WORKER_USD_PER_MEMORY_GB_HOUR',
  workerTaskVcpus: 'PRICING_WORKER_TASK_VCPUS',
  workerTaskMemoryGb: 'PRICING_WORKER_TASK_MEMORY_GB',
  workerTaskProcesses: 'PRICING_WORKER_TASK_PROCESSES',
  usdPerDownloadedGb: 'PRICING_USD_PER_DOWNLOADED_GB',
  usdPerFileStorageGbMonth: 'PRICING_USD_PER_FILE_STORAGE_GB_MONTH',
  usdPerDatabaseStorageGbMonth: 'PRICING_USD_PER_DATABASE_STORAGE_GB_MONTH',
  margin: 'PRICING_MARGIN',
  minimumBalanceFloorCredits: 'PRICING_MINIMUM_BALANCE_FLOOR_CREDITS',
} as const;

export type PricingValueName = keyof typeof PRICING_VARIABLES;

// The GB that per-GB rates are quoted in. AWS bills data transfer and
// storage in binary gigabytes, 2^30 bytes.
export const BYTES_PER_GB = 1024 ** 3;

// How each value is checked. A rate or a task size must be above zero, since
// a zero would make that usage free. Tabs and processes count things, so they
// are whole numbers. The floor may be zero, because the minimum balance an
// automation computes from its caps is never below the most one of its runs
// can cost anyway (ADR 029 §1.5).
type ValueKind =
  | 'positive'
  | 'positiveInteger'
  | 'margin'
  | 'nonNegativeInteger';

const VALUE_KINDS: Record<PricingValueName, ValueKind> = {
  prerenderUsdPerVcpuHour: 'positive',
  prerenderUsdPerMemoryGbHour: 'positive',
  prerenderTaskVcpus: 'positive',
  prerenderTaskMemoryGb: 'positive',
  prerenderTaskTabs: 'positiveInteger',
  workerUsdPerVcpuHour: 'positive',
  workerUsdPerMemoryGbHour: 'positive',
  workerTaskVcpus: 'positive',
  workerTaskMemoryGb: 'positive',
  workerTaskProcesses: 'positiveInteger',
  usdPerDownloadedGb: 'positive',
  usdPerFileStorageGbMonth: 'positive',
  usdPerDatabaseStorageGbMonth: 'positive',
  margin: 'margin',
  minimumBalanceFloorCredits: 'nonNegativeInteger',
};

export type PricingValues = Record<PricingValueName, number>;

export interface Pricing {
  values: PricingValues;
  // A hash of the values, recorded on every metered charge so a charge can
  // be traced to the exact prices it used (ADR 029 §1.4). Two processes with
  // the same values report the same version, however the values were
  // written ("1.50" and "1.5" are the same price).
  version: string;
  // Hosting cost of one second of one prerender tab: the prerender task's
  // hourly cost divided over its tabs.
  prerenderTabUsdPerSecond: number;
  // Hosting cost of one second of one worker process: the worker task's
  // hourly cost divided over its processes.
  workerProcessUsdPerSecond: number;
}

export interface PricingProblem {
  variable: string;
  problem: string;
}

export type PricingCheck =
  | { ok: true; pricing: Pricing }
  | { ok: false; problems: PricingProblem[] };

// Plain decimal numbers only: no sign, exponent, hex, whitespace or
// thousands separator. Anything a person could mistype into something that
// parses to a different number is refused rather than guessed at.
const DECIMAL = /^\d+(\.\d+)?$/;
const INTEGER = /^\d+$/;

function checkValue(
  kind: ValueKind,
  raw: string | undefined,
): { value: number } | { problem: string } {
  if (raw === undefined || raw === '') {
    return { problem: 'is not set' };
  }
  let integer = kind === 'positiveInteger' || kind === 'nonNegativeInteger';
  if (!(integer ? INTEGER : DECIMAL).test(raw)) {
    return {
      problem: integer
        ? `must be a whole number, got ${JSON.stringify(raw)}`
        : `must be a plain decimal number, got ${JSON.stringify(raw)}`,
    };
  }
  let value = Number(raw);
  if (integer ? !Number.isSafeInteger(value) : !Number.isFinite(value)) {
    return { problem: `is out of range, got ${JSON.stringify(raw)}` };
  }
  switch (kind) {
    case 'positive':
    case 'positiveInteger':
      if (value <= 0) {
        return { problem: `must be above 0, got ${raw}` };
      }
      break;
    case 'margin':
      if (value < 1) {
        return { problem: `must be at least 1, got ${raw}` };
      }
      break;
    case 'nonNegativeInteger':
      break;
  }
  return { value };
}

export function pricingVersion(values: PricingValues): string {
  let canonical = (Object.keys(PRICING_VARIABLES) as PricingValueName[])
    .sort()
    .map((name) => [name, values[name]]);
  return createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex')
    .slice(0, 16);
}

// Reads and checks every pricing value from `env`. Pure: it neither logs nor
// changes the process's current pricing.
export function readPricing(
  env: Record<string, string | undefined> = process.env,
): PricingCheck {
  let problems: PricingProblem[] = [];
  let values = {} as PricingValues;
  for (let name of Object.keys(PRICING_VARIABLES) as PricingValueName[]) {
    let variable = PRICING_VARIABLES[name];
    let result = checkValue(VALUE_KINDS[name], env[variable]);
    if ('problem' in result) {
      problems.push({ variable, problem: result.problem });
    } else {
      values[name] = result.value;
    }
  }
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    pricing: {
      values,
      version: pricingVersion(values),
      prerenderTabUsdPerSecond:
        (values.prerenderTaskVcpus * values.prerenderUsdPerVcpuHour +
          values.prerenderTaskMemoryGb * values.prerenderUsdPerMemoryGbHour) /
        values.prerenderTaskTabs /
        3600,
      workerProcessUsdPerSecond:
        (values.workerTaskVcpus * values.workerUsdPerVcpuHour +
          values.workerTaskMemoryGb * values.workerUsdPerMemoryGbHour) /
        values.workerTaskProcesses /
        3600,
    },
  };
}

let current: Pricing | undefined;

// The prices this process checked at startup, or undefined when its check
// failed or has not run. Undefined means the process must not admit a new
// run or submit a new batch (ADR 029 §1.3).
export function currentPricing(): Pricing | undefined {
  return current;
}

// The startup check each of the realm-server, worker and prerender processes
// runs once. A passing check logs every value and the pricing version. A
// failing one logs every problem at error level and sends it to Sentry, which
// is what pricing alerts fire on, and leaves the process without prices.
export interface PricingReporter {
  info(message: string): void;
  error(message: string): void;
  alert(
    message: string,
    context: { level: 'error'; tags: Record<string, string> },
  ): void;
}

const defaultReporter: PricingReporter = {
  info: (message) => log.info(message),
  error: (message) => log.error(message),
  alert: (message, context) => {
    Sentry.captureMessage(message, context);
  },
};

export function checkPricingAtStartup(
  processName: string,
  env: Record<string, string | undefined> = process.env,
  reporter: PricingReporter = defaultReporter,
): PricingCheck {
  let check = readPricing(env);
  if (check.ok) {
    current = check.pricing;
    let { values, version } = check.pricing;
    reporter.info(
      `pricing check passed in ${processName}: pricing version ${version}; ${(
        Object.keys(PRICING_VARIABLES) as PricingValueName[]
      )
        .map((name) => `${PRICING_VARIABLES[name]}=${values[name]}`)
        .join(' ')}`,
    );
  } else {
    current = undefined;
    let message = `pricing check failed in ${processName}: this process has no prices, so it must not admit automation runs or submit batches until its pricing variables are fixed and it restarts. ${check.problems
      .map(({ variable, problem }) => `${variable} ${problem}`)
      .join('; ')}`;
    reporter.error(message);
    reporter.alert(message, {
      level: 'error',
      tags: { pricingCheck: 'failed', process: processName },
    });
  }
  return check;
}
