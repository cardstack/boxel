import {
  DBAdapter,
  Expression,
  addExplicitParens,
  asExpressions,
  param,
  query,
  separatedByCommas,
} from '@cardstack/runtime-common';
import { StripeEvent } from './stripe-webhook-handlers';

export interface User {
  id: string;
  matrixUserId: string;
  stripeCustomerId: string;
}

export async function insertStripeEvent(
  dbAdapter: DBAdapter,
  event: StripeEvent,
) {
  let { valueExpressions, nameExpressions: _nameExpressions } = asExpressions({
    stripe_event_id: event.id,
    event_type: event.type,
    event_data: event.data,
  });
  await query(dbAdapter, [
    `INSERT INTO stripe_events (stripe_event_id, event_type, event_data) VALUES`,
    ...addExplicitParens(separatedByCommas(valueExpressions)),
  ] as Expression);
}

export async function updateUserStripeCustomerId(
  dbAdapter: DBAdapter,
  userId: string,
  stripeCustomerId: string,
) {
  await query(dbAdapter, [
    `UPDATE users SET stripe_customer_id = `,
    param(stripeCustomerId),
    ` WHERE matrix_user_id = `,
    param(userId),
  ]);
}

export async function getUserByStripeId(
  dbAdapter: DBAdapter,
  stripeCustomerId: string,
) {
  let results = await query(dbAdapter, [
    `SELECT * FROM users WHERE stripe_customer_id = `,
    param(stripeCustomerId),
  ]);

  if (results.length !== 1) {
    throw new Error(
      `No user found with stripe customer id: ${stripeCustomerId}`,
    );
  }

  return results[0];
}
