import type * as JSONTypes from 'json-typescript';
import type { Task } from './index';
import { asExpressions, insert, jobIdentity, query } from '../index';

export interface DailyCreditGrantArgs extends JSONTypes.Object {
  lowCreditThreshold: number;
}

export { dailyCreditGrant };

const dailyCreditGrant: Task<DailyCreditGrantArgs, void> = ({
  dbAdapter,
  log,
  reportStatus,
}) =>
  async function (args) {
    let { jobInfo } = args;
    log.debug(
      `${jobIdentity(jobInfo)} starting daily-credit-grant for job: ${JSON.stringify(
        args,
      )}`,
    );
    reportStatus(jobInfo, 'start');

    let { lowCreditThreshold } = args;
    if (!Number.isInteger(lowCreditThreshold) || lowCreditThreshold < 0) {
      throw new Error(
        `daily-credit-grant requires a non-negative integer lowCreditThreshold (received ${lowCreditThreshold}).`,
      );
    }

    let rows = await query(dbAdapter, [
      `SELECT users.id as user_id,
        COALESCE(SUM(credits_ledger.credit_amount), 0) as credit_balance,
        EXISTS (
          SELECT 1 FROM credits_ledger daily
          WHERE daily.user_id = users.id
            AND daily.credit_type = 'daily_credit'
            AND daily.created_at >= EXTRACT(epoch FROM date_trunc('day', NOW()))::integer
            AND daily.created_at < EXTRACT(epoch FROM date_trunc('day', NOW()) + interval '1 day')::integer
        ) as granted_today
      FROM users
      LEFT JOIN credits_ledger ON credits_ledger.user_id = users.id
      GROUP BY users.id`,
    ]);

    let grantedCount = 0;
    for (let row of rows) {
      let currentBalance = Number(row.credit_balance ?? 0);
      let grantedToday = Boolean(row.granted_today);
      if (Number.isNaN(currentBalance) || grantedToday) {
        continue;
      }
      let creditAmount = lowCreditThreshold - currentBalance;
      if (creditAmount <= 0) {
        continue;
      }

      let { nameExpressions, valueExpressions } = asExpressions({
        user_id: row.user_id,
        credit_amount: creditAmount,
        credit_type: 'daily_credit',
        subscription_cycle_id: null,
      });
      await query(
        dbAdapter,
        insert('credits_ledger', nameExpressions, valueExpressions),
      );
      grantedCount++;
    }

    log.info(
      `${jobIdentity(jobInfo)} granted daily credits to ${grantedCount} user(s)`,
    );
    reportStatus(jobInfo, 'finish');
  };
