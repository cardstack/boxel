// The limits a share or a personal key carries, as its owner set them or, where
// they set none, as the platform's defaults fill them in. Enforcement is in
// `key-limits.ts`; this module only reads and describes them, so the share and
// key listings can show them without depending on the call path.

// How much of a key interactive calls may spend:
//
// - `rateBurst` and `rateRefillPerMinute`: a token bucket per caller. A full
//   refresh fits in one burst; a runaway loop is held to the refill.
// - `dailyBudget` and `monthlyBudget`: calls the share or key serves in one
//   UTC day or month, across every caller. These count calls, not money: what
//   a vendor charges for a call is not something the platform can see.
export interface KeyLimits {
  rateBurst: number;
  rateRefillPerMinute: number;
  dailyBudget: number;
  monthlyBudget: number;
}

// The platform's defaults, and the share of a budget at which owners are
// told its use is getting high.
export interface KeyLimitDefaults {
  rateBurst: number;
  rateRefillPerMinute: number;
  dailyBudget: number;
  // Percent of a period's budget whose use sends the high-water notice.
  highWaterPercent: number;
  // Percent of a share's daily budget that people who aren't signed in may
  // spend through it, all together. The rest is always left for signed-in
  // readers, whatever anonymous cap the key's owner set, or none.
  anonymousSharePercent: number;
}

// The rate limit follows the largest refresh of the first integration, an
// inbox of pull requests that makes 25 calls every 5 minutes: a burst of 25
// holds one whole refresh, and a refill of 15 calls a minute keeps three open
// tabs refreshing on that schedule (3 × 25 / 5).
//
// The daily budget is that inbox open through a working day in one tab: 25
// calls every 5 minutes for 8 hours, 2,400 calls. It is the suggestion an
// owner starts from, and an owner whose vendor plan allows more raises it.
export const DEFAULT_KEY_LIMITS: KeyLimitDefaults = {
  rateBurst: 25,
  rateRefillPerMinute: 15,
  dailyBudget: 2400,
  highWaterPercent: 80,
  anonymousSharePercent: 50,
};

// A monthly budget nobody set is this many daily budgets.
export const MONTHLY_BUDGET_DAYS = 30;

// The largest value a limit may be set to: what the columns hold.
export const MAX_KEY_LIMIT = 2_147_483_647;

// The stored limit columns, on `key_shares` and on `user_keys` alike. Null is
// the platform's default.
export const KEY_LIMIT_COLUMNS =
  'rate_burst, rate_refill_per_minute, daily_budget, monthly_budget';

let configured: KeyLimitDefaults = DEFAULT_KEY_LIMITS;

export function keyLimitDefaults(): KeyLimitDefaults {
  return configured;
}

// Sets the platform's defaults, from `keyLimitDefaultsFromEnv` at startup or a
// test's own; with nothing, back to `DEFAULT_KEY_LIMITS`.
export function setKeyLimitDefaults(defaults?: KeyLimitDefaults): void {
  configured = defaults ?? DEFAULT_KEY_LIMITS;
}

// The defaults as the platform's environment overrides them:
// `KEY_RATE_LIMIT_BURST`, `KEY_RATE_LIMIT_REFILL_PER_MINUTE`,
// `KEY_DAILY_BUDGET`, `KEY_BUDGET_HIGH_WATER_PERCENT` and
// `KEY_ANONYMOUS_SHARE_PERCENT`. A value that isn't
// a limit stops startup rather than leave keys unlimited.
export function keyLimitDefaultsFromEnv(
  env: Record<string, string | undefined> = process.env,
): KeyLimitDefaults {
  let read = (
    name: string,
    fallback: number,
    valid: (n: number) => boolean,
    what: string,
  ) => {
    let value = env[name];
    if (value === undefined || value === '') {
      return fallback;
    }
    let n = Number(value);
    if (!valid(n)) {
      throw new Error(`${name} must be ${what}, not "${value}"`);
    }
    return n;
  };
  let whole = (n: number) =>
    Number.isInteger(n) && n >= 1 && n <= MAX_KEY_LIMIT;
  return {
    rateBurst: read(
      'KEY_RATE_LIMIT_BURST',
      DEFAULT_KEY_LIMITS.rateBurst,
      whole,
      'a whole number of at least one',
    ),
    rateRefillPerMinute: read(
      'KEY_RATE_LIMIT_REFILL_PER_MINUTE',
      DEFAULT_KEY_LIMITS.rateRefillPerMinute,
      (n) => Number.isFinite(n) && n > 0 && n <= MAX_KEY_LIMIT,
      'a positive number',
    ),
    dailyBudget: read(
      'KEY_DAILY_BUDGET',
      DEFAULT_KEY_LIMITS.dailyBudget,
      whole,
      'a whole number of at least one',
    ),
    highWaterPercent: read(
      'KEY_BUDGET_HIGH_WATER_PERCENT',
      DEFAULT_KEY_LIMITS.highWaterPercent,
      (n) => Number.isFinite(n) && n > 0 && n < 100,
      'a percentage above 0 and below 100',
    ),
    anonymousSharePercent: read(
      'KEY_ANONYMOUS_SHARE_PERCENT',
      DEFAULT_KEY_LIMITS.anonymousSharePercent,
      (n) => Number.isFinite(n) && n > 0 && n < 100,
      'a percentage above 0 and below 100',
    ),
  };
}

// The limits as the share and key listings, their usage and the limits routes
// serve them: those in force, plus what tells a value the owner chose from
// one the platform filled in, so a form can show a default as a default.
//
// - `set`: each limit as the owner set it, or null where they left the
//   default.
// - `defaults`: what an unset limit takes. An unset monthly budget is
//   `monthlyBudgetDays` daily budgets of the daily budget in force, so it
//   follows the daily budget; a monthly budget the owner set stays put when
//   the daily budget changes.
export interface KeyLimitsView extends KeyLimits {
  set: Record<keyof KeyLimits, number | null>;
  defaults: {
    rateBurst: number;
    rateRefillPerMinute: number;
    dailyBudget: number;
    monthlyBudgetDays: number;
  };
}

// A row's limits, each one its owner left unset filled in from the defaults.
// A monthly budget left unset is `MONTHLY_BUDGET_DAYS` daily budgets, of the
// daily budget in force, so raising the daily budget raises it too.
export function limitsOf(
  row: Record<string, unknown>,
  defaults: KeyLimitDefaults = configured,
): KeyLimits {
  let stored = (column: string) =>
    row[column] == null ? undefined : Number(row[column]);
  let dailyBudget = stored('daily_budget') ?? defaults.dailyBudget;
  return {
    rateBurst: stored('rate_burst') ?? defaults.rateBurst,
    rateRefillPerMinute:
      stored('rate_refill_per_minute') ?? defaults.rateRefillPerMinute,
    dailyBudget,
    monthlyBudget:
      stored('monthly_budget') ??
      Math.min(MAX_KEY_LIMIT, dailyBudget * MONTHLY_BUDGET_DAYS),
  };
}

// A row's limits as they're served: in force, as its owner set them, and the
// defaults an unset one takes (see `KeyLimitsView`).
export function limitsViewOf(
  row: Record<string, unknown>,
  defaults: KeyLimitDefaults = configured,
): KeyLimitsView {
  let stored = (column: string) =>
    row[column] == null ? null : Number(row[column]);
  return {
    ...limitsOf(row, defaults),
    set: {
      rateBurst: stored('rate_burst'),
      rateRefillPerMinute: stored('rate_refill_per_minute'),
      dailyBudget: stored('daily_budget'),
      monthlyBudget: stored('monthly_budget'),
    },
    defaults: {
      rateBurst: defaults.rateBurst,
      rateRefillPerMinute: defaults.rateRefillPerMinute,
      dailyBudget: defaults.dailyBudget,
      monthlyBudgetDays: MONTHLY_BUDGET_DAYS,
    },
  };
}
