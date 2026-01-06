import type * as JSONTypes from 'json-typescript';
import type { Task } from './index';
import {
  addExplicitParens,
  asExpressions,
  jobIdentity,
  query,
  separatedByCommas,
  type Expression,
} from '../index';

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

    // PERF: This scans all users + aggregates full ledger each run; consider a
    // materialized balance table/view (or denormalized user balance) to avoid
    // re-summing credits_ledger and to make the daily eligibility check cheaper.
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
    let rowsToInsert: {
      user_id: string;
      credit_amount: number;
      credit_type: 'daily_credit';
      subscription_cycle_id: null;
    }[] = [];
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

      rowsToInsert.push({
        user_id: row.user_id,
        credit_amount: creditAmount,
        credit_type: 'daily_credit',
        subscription_cycle_id: null,
      });
      grantedCount++;
    }

    if (rowsToInsert.length > 0) {
      let nameExpressions: string[][] | undefined;
      let valueRows: Expression[][] = [];
      for (let row of rowsToInsert) {
        let { nameExpressions: rowNames, valueExpressions } = asExpressions(row);
        if (!nameExpressions) {
          nameExpressions = rowNames;
        }
        valueRows.push(valueExpressions);
      }

      await query(dbAdapter, [
        'INSERT INTO',
        'credits_ledger',
        ...addExplicitParens(separatedByCommas(nameExpressions!)),
        'VALUES',
        ...separatedByCommas(
          valueRows.map((valueExpressions) =>
            addExplicitParens(separatedByCommas(valueExpressions)),
          ),
        ),
      ]);
    }

    log.info(
      `${jobIdentity(jobInfo)} granted daily credits to ${grantedCount} user(s)`,
    );
    reportStatus(jobInfo, 'finish');
  };
