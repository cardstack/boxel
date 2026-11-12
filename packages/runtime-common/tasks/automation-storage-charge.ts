import type * as JSONTypes from 'json-typescript';
import type { Task } from './index.ts';
import { jobIdentity } from '../index.ts';
import { chargeAutomationStorage } from '../automation-storage-charge.ts';

// Charges every switched-on automation's storage through `day`, a UTC
// YYYY-MM-DD date that has ended. The cron names the day when it enqueues the
// job, so a job that waits in the queue past midnight still charges the day
// it was enqueued for.
export interface AutomationStorageChargeArgs extends JSONTypes.Object {
  day: string;
}

export interface AutomationStorageChargeJobResult extends JSONTypes.Object {
  charged: number;
  failed: number;
}

export { automationStorageCharge };

// No coalesce handler: every charge is written once, by its automation and
// day, so a duplicate job (each worker manager fires the cron) finds each
// charge already made and writes nothing. The concurrency group serializes
// the jobs.
const automationStorageCharge: Task<
  AutomationStorageChargeArgs,
  AutomationStorageChargeJobResult
> = ({ dbAdapter, meteredCharges, log, reportStatus }) =>
  async function (args) {
    let { jobInfo, day } = args;
    reportStatus(jobInfo, 'start');
    try {
      if (!meteredCharges) {
        log.error(
          `${jobIdentity(jobInfo)} automation-storage-charge for ${day}: this worker has no metered charges, so no storage is charged`,
        );
        return { charged: 0, failed: 0 };
      }
      let { charges, failed } = await chargeAutomationStorage(
        dbAdapter,
        meteredCharges,
        day,
      );
      for (let { automationId, error } of failed) {
        log.error(
          `${jobIdentity(jobInfo)} could not charge the storage of automation ${automationId} through ${day}:`,
          error,
        );
      }
      let charged = charges.filter(
        (charge) => charge.outcome === 'charged',
      ).length;
      log.info(
        `${jobIdentity(jobInfo)} automation-storage-charge through ${day}: ${charged} charged, ${charges.length - charged} not charged, ${failed.length} failed`,
      );
      return { charged, failed: failed.length };
    } finally {
      reportStatus(jobInfo, 'finish');
    }
  };
