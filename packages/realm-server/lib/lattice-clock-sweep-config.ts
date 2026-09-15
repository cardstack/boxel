import { CronJob } from 'cron';

// Every five minutes by default: a grain boundary is a calendar date or an
// instant, and a five-minute lag on a value that changes once a day (an age,
// days remaining) or at a scheduled expiry is within the freshness budget.
export const LATTICE_CLOCK_SWEEP_CRON_SCHEDULE =
  process.env.LATTICE_CLOCK_SWEEP_CRON_SCHEDULE ?? '*/5 * * * *';
export const LATTICE_CLOCK_SWEEP_CRON_TZ =
  process.env.LATTICE_REALM_TIME_ZONE ?? 'America/New_York';

export function createLatticeClockSweepCronJob(
  onTick: () => void,
  options: { runOnInit?: boolean } = {},
) {
  return new CronJob(
    LATTICE_CLOCK_SWEEP_CRON_SCHEDULE,
    onTick,
    null,
    false,
    LATTICE_CLOCK_SWEEP_CRON_TZ,
    null,
    options.runOnInit ?? false,
  );
}
