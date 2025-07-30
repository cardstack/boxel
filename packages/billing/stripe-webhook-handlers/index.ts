import { DBAdapter, decodeWebSafeBase64 } from '@cardstack/runtime-common';
import { handlePaymentSucceeded } from './payment-succeeded';
import { handleCheckoutSessionCompleted } from './checkout-session-completed';

import Stripe from 'stripe';
import { handleSubscriptionDeleted } from './subscription-deleted';
import { getUserByStripeId } from '../billing-queries';

export type StripeEvent = {
  id: string;
  type: string;
  data: {
    object: {
      id: string;
      [key: string]: any;
    };
  };
};

export type StripeInvoicePaymentSucceededWebhookEvent = StripeEvent & {
  object: 'event';
  type: 'invoice.payment_succeeded';
  data: {
    object: {
      id: string;
      object: 'invoice';
      amount_paid: number;
      billing_reason:
        | 'subscription_create'
        | 'subscription_cycle'
        | 'subscription_update';
      period_start: number;
      period_end: number;
      subscription: string;
      customer: string;
      lines: {
        data: Array<{
          amount: number;
          description: string;
          price: {
            product: string;
          };
          period: {
            start: number;
            end: number;
          };
        }>;
      };
    };
  };
};

export type StripeSubscriptionDeletedWebhookEvent = StripeEvent & {
  object: 'event';
  type: 'customer.subscription.deleted';
  data: {
    object: {
      id: string; // stripe subscription id
      canceled_at: number;
      current_period_end: number;
      current_period_start: number;
      customer: string;
      cancellation_details: {
        comment: string | null;
        feedback: string;
        reason:
          | 'cancellation_requested'
          | 'payment_failure'
          | 'payment_disputed';
      };
    };
  };
};

export type StripeCheckoutSessionCompletedWebhookEvent = StripeEvent & {
  object: 'event';
  type: 'checkout.session.completed';
  data: {
    object: {
      id: string;
      object: 'checkout.session';
      client_reference_id: string;
      customer: string | null; // string when payment link is for subscribing to the free plan, null when buying extra credits
      customer_details: {
        email: string;
      };
      metadata: {
        credit_reload_amount: string;
        user_id: string;
      };
    };
  };
};

// Make sure Stripe customer portal is configured with the following settings:
// Cancel at end of billing period: CHECKED
// Customers can switch plans: CHECKED
// Prorate subscription changes: CHECKED
// Invoice immediately (when prorating): CHECKED
// When switching to a cheaper subscription -> WAIT UNTIL END OF BILLING PERIOD TO UPDATE

export default async function stripeWebhookHandler({
  dbAdapter,
  request,
  sendMatrixEvent,
}: {
  dbAdapter: DBAdapter;
  request: Request;
  sendMatrixEvent: (matrixUserId: string, eventType: string) => Promise<void>;
}): Promise<Response> {
  let signature = request.headers.get('stripe-signature');

  if (!signature) {
    throw new Error('No Stripe signature found in request headers');
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  }

  let event: StripeEvent;

  try {
    event = Stripe.webhooks.constructEvent(
      await request.text(),
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    ) as StripeEvent;
  } catch (error) {
    throw new Error(`Error verifying webhook signature: ${error}`);
  }

  let type = event.type;

  switch (type) {
    // These handlers should eventually become jobs which workers will process asynchronously
    case 'invoice.payment_succeeded': {
      await handlePaymentSucceeded(
        dbAdapter,
        event as StripeInvoicePaymentSucceededWebhookEvent,
      );
      sendBillingNotification({
        dbAdapter,
        sendMatrixEvent,
        stripeEvent: event,
      });
      break;
    }
    case 'customer.subscription.deleted': {
      // canceled by the user, or expired due to payment failure, or payment dispute
      await handleSubscriptionDeleted(
        dbAdapter,
        event as StripeSubscriptionDeletedWebhookEvent,
      );
      sendBillingNotification({
        dbAdapter,
        sendMatrixEvent,
        stripeEvent: event,
      });
      break;
    }
    case 'checkout.session.completed': {
      await handleCheckoutSessionCompleted(
        dbAdapter,
        event as StripeCheckoutSessionCompletedWebhookEvent,
      );
      sendBillingNotification({
        dbAdapter,
        sendMatrixEvent,
        stripeEvent: event,
      });
      break;
    }
  }
  return new Response('ok');
}

async function sendBillingNotification({
  dbAdapter,
  sendMatrixEvent,
  stripeEvent,
}: {
  dbAdapter: DBAdapter;
  sendMatrixEvent: (matrixUserId: string, eventType: string) => Promise<void>;
  stripeEvent: StripeEvent;
}) {
  let matrixUserId = await extractMatrixUserId(dbAdapter, stripeEvent);
  await sendMatrixEvent(matrixUserId, 'billing-notification');
}

// Stripe events will have a `customer` (stripe customer id) field in the "invoice.payment_succeeded" event
// but not in the "checkout.session.completed" event. In the latter case, we need to look up the user by
// the `client_reference_id` field, which is a url parameter with the value of an encoded matrix user id
// (these are the payment links for subscribing to the free plan, and buying extra credits)
async function extractMatrixUserId(dbAdapter: DBAdapter, event: StripeEvent) {
  let encodedMatrixUserId = event.data.object.client_reference_id;
  let matrixUserId = encodedMatrixUserId
    ? decodeWebSafeBase64(encodedMatrixUserId)
    : undefined;

  if (!matrixUserId && event.data.object.customer) {
    let user = await getUserByStripeId(dbAdapter, event.data.object.customer);
    matrixUserId = user?.matrixUserId;
  }

  if (!matrixUserId) {
    throw new Error('Failed to extract matrix user id from stripe event');
  }

  return matrixUserId;
}
