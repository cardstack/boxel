import { CronJob } from 'cron';

export const DAILY_CREDIT_GRANT_CRON_SCHEDULE =
  process.env.DAILY_CREDIT_GRANT_CRON_SCHEDULE ?? '0 3 * * *';
export const DAILY_CREDIT_GRANT_CRON_TZ =
  process.env.DAILY_CREDIT_GRANT_CRON_TZ ?? 'America/New_York';
export const DEFAULT_SIGNUP_CREDITS = 2000;

export function parseLowCreditThreshold(
  rawThreshold = process.env.LOW_CREDIT_THRESHOLD,
): number {
  if (rawThreshold == null || rawThreshold === '') {
    throw new Error(
      'LOW_CREDIT_THRESHOLD must be set to run daily-credit-grant',
    );
  }
  let lowCreditThreshold = Number(rawThreshold);
  if (!Number.isInteger(lowCreditThreshold) || lowCreditThreshold < 0) {
    throw new Error(
      `LOW_CREDIT_THRESHOLD must be a non-negative integer. Received "${rawThreshold}".`,
    );
  }
  return lowCreditThreshold;
}

export function getLowCreditThreshold(): number | null {
  try {
    return parseLowCreditThreshold();
  } catch (error) {
    return null;
  }
}

export function getSignupCreditGrantAmount(): number {
  return getLowCreditThreshold() ?? DEFAULT_SIGNUP_CREDITS;
}

export function getNextDailyCreditGrantAt(): number | null {
  try {
    let job = createDailyCreditGrantCronJob(() => {});
    let nextDates = (
      job as CronJob & { nextDates?: (count?: number) => unknown }
    ).nextDates;
    if (!nextDates) {
      return null;
    }
    let nextDate = nextDates.call(job, 1) as Date | Date[] | object;
    let nextValue = Array.isArray(nextDate) ? nextDate[0] : nextDate;
    let nextMillis = Number(nextValue);
    if (!Number.isFinite(nextMillis)) {
      return null;
    }
    return Math.floor(nextMillis / 1000);
  } catch (error) {
    return null;
  }
}

export function createDailyCreditGrantCronJob(
  onTick: () => void,
  options: { runOnInit?: boolean } = {},
) {
  return new CronJob(
    DAILY_CREDIT_GRANT_CRON_SCHEDULE,
    onTick,
    null,
    false,
    DAILY_CREDIT_GRANT_CRON_TZ,
    null,
    options.runOnInit ?? false,
  );
}
