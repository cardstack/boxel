import { decodeWebSafeBase64, type DBAdapter } from '@cardstack/runtime-common';
import {
  addToCreditsLedger,
  getCurrentActiveSubscription,
  getMostRecentSubscriptionCycle,
  getUserByMatrixUserId,
  getUserByStripeId,
  insertStripeEvent,
  markStripeEventAsProcessed,
  updateUserStripeCustomerEmail,
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

    let stripeCustomerId = event.data.object.customer;
    let encodedMatrixId = event.data.object.client_reference_id;
    let stripeCustomerEmail = event.data.object.customer_details?.email;
    let matrixUserId = decodeWebSafeBase64(encodedMatrixId);

    if (!matrixUserId) {
      throw new Error(
        'No matrix user id found in checkout session completed event - this should be populated using client_reference_id query param in the payment link',
      );
    }

    // Stripe customer id will be present when user is subscribing to the free plan, but not when they are adding extra credits
    if (stripeCustomerId) {
      await updateUserStripeCustomerId(
        dbAdapter,
        matrixUserId,
        stripeCustomerId,
      );
    } else {
      let user = await getUserByMatrixUserId(dbAdapter, matrixUserId);

      if (!user) {
        throw new Error(`User not found for matrix user id: ${matrixUserId}`);
      }

      stripeCustomerId = user.stripeCustomerId;
    }

    if (stripeCustomerEmail) {
      await updateUserStripeCustomerEmail(
        dbAdapter,
        stripeCustomerId,
        stripeCustomerEmail,
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

      let subscription = await getCurrentActiveSubscription(dbAdapter, user.id);
      if (!subscription) {
        throw new Error(
          `User ${user.id} has no subscription, cannot add extra credits`,
        );
      }
      let subscriptionCycle = await getMostRecentSubscriptionCycle(
        dbAdapter,
        subscription!.id,
      );
      if (!subscriptionCycle) {
        throw new Error(
          `User ${user.id} has no subscription cycle, cannot add extra credits`,
        );
      }

      await addToCreditsLedger(dbAdapter, {
        userId: user.id,
        creditAmount: creditReloadAmount,
        creditType: 'extra_credit',
        subscriptionCycleId: subscriptionCycle.id,
      });
    }
  });

  await markStripeEventAsProcessed(dbAdapter, event.id);
}
