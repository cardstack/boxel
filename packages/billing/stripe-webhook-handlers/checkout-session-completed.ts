import { type DBAdapter } from '@cardstack/runtime-common';
import {
  addToCreditsLedger,
  getUserByStripeId,
  insertStripeEvent,
  markStripeEventAsProcessed,
  updateUserStripeCustomerId,
} from '../billing-queries';
import { StripeCheckoutSessionCompletedWebhookEvent } from '.';

import { PgAdapter, TransactionManager } from '@cardstack/postgres';

// We are handling 2 cases here:
// 1. User is subscribing to the free plan using the Stripe payment link after signing up for Boxel
//   - Stripe payment link will include the client_reference_id param, set by the host app, which will be the user's matrix username
//   - When checkout session is completed, we will get that param value here so that we can see who the customer is, and update their Stripe customer id in our db because we need it to identify the Stripe user for all subsequent stripe events
// 2. User is adding extra credits to their account
//   - Stripe payment link will not include the client_reference_id param in this case (but this won't break even if it's included)
//   - Instead, we read credit_reload_amount from the metadata, which is configured for payment links in Stripe, and add that amount to the user's ledger
export async function handleCheckoutSessionCompleted(
  dbAdapter: DBAdapter,
  event: StripeCheckoutSessionCompletedWebhookEvent,
) {
  let txManager = new TransactionManager(dbAdapter as PgAdapter);

  await txManager.withTransaction(async () => {
    await insertStripeEvent(dbAdapter, event);

    const stripeCustomerId = event.data.object.customer;
    const matrixUserName = event.data.object.client_reference_id;

    if (matrixUserName) {
      // The matrix user id was encoded to be alphanumeric by replacing + with - and / with _
      // Now we need to reverse that encoding to get back the original base64 string
      const base64UserId = matrixUserName.replace(/-/g, '+').replace(/_/g, '/');
      const decodedMatrixUserName = Buffer.from(
        base64UserId,
        'base64',
      ).toString('utf8');
      await updateUserStripeCustomerId(
        dbAdapter,
        decodedMatrixUserName,
        stripeCustomerId,
      );
    }

    let creditReloadAmount =
      'credit_reload_amount' in event.data.object.metadata
        ? parseInt(event.data.object.metadata.credit_reload_amount)
        : null;

    if (creditReloadAmount) {
      let user = await getUserByStripeId(dbAdapter, stripeCustomerId);
      if (!user) {
        throw new Error(
          `User not found for stripe customer id: ${stripeCustomerId}`,
        );
      }

      await addToCreditsLedger(dbAdapter, {
        userId: user.id,
        creditAmount: creditReloadAmount,
        creditType: 'extra_credit',
        subscriptionCycleId: null,
      });
    }
  });

  await markStripeEventAsProcessed(dbAdapter, event.id);
}
