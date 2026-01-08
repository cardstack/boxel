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
    let rows = (await query(dbAdapter, [
      `SELECT user_id, credit_amount, granted_today
      FROM (
        SELECT users.id AS user_id,
          (${lowCreditThreshold} - COALESCE(SUM(credits_ledger.credit_amount), 0)) AS credit_amount,
          EXISTS (
            SELECT 1 FROM credits_ledger daily
            WHERE daily.user_id = users.id
              AND daily.credit_type = 'daily_credit'
              AND daily.created_at >= EXTRACT(epoch FROM date_trunc('day', NOW()))::integer
              AND daily.created_at < EXTRACT(epoch FROM date_trunc('day', NOW()) + interval '1 day')::integer
          ) AS granted_today
        FROM users
        LEFT JOIN credits_ledger ON credits_ledger.user_id = users.id
        GROUP BY users.id
      ) balances
      WHERE credit_amount > 0
        AND granted_today = false`,
    ])) as {
      user_id: string;
      credit_amount: string | null;
    }[];

    let grantedCount = 0;
    let rowsToInsert: {
      user_id: string;
      credit_amount: number;
      credit_type: 'daily_credit';
      subscription_cycle_id: null;
    }[] = [];
    for (let row of rows) {
      let creditAmount = Number(row.credit_amount ?? 0);
      if (Number.isNaN(creditAmount) || creditAmount <= 0) {
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
      let nameExpressions: Expression[] | undefined;
      let valueRows: Expression[][] = [];
      for (let row of rowsToInsert) {
        let { nameExpressions: rowNames, valueExpressions } =
          asExpressions(row);
        if (!nameExpressions) {
          nameExpressions = rowNames as Expression[];
        }
        valueRows.push(valueExpressions);
      }

      let valueExpressionRows = valueRows.map(
        (valueExpressions) =>
          addExplicitParens(
            separatedByCommas(valueExpressions as Expression[]),
          ) as Expression,
      );

      let insertExpression = [
        'INSERT INTO',
        'credits_ledger',
        ...(addExplicitParens(
          separatedByCommas(nameExpressions as Expression[]),
        ) as Expression),
        'VALUES',
        ...(separatedByCommas(
          valueExpressionRows as Expression[],
        ) as Expression),
      ] as Expression;

      await query(dbAdapter, insertExpression);
    }

    log.info(
      `${jobIdentity(jobInfo)} granted daily credits to ${grantedCount} user(s)`,
    );
    reportStatus(jobInfo, 'finish');
  };
