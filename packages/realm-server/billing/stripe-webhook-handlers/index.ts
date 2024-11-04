import { DBAdapter } from '@cardstack/runtime-common';
import { handlePaymentSucceeded } from './payment-succeeded';
import { handleCheckoutSessionCompleted } from './checkout-session-completed';

import Stripe from 'stripe';
import { handleSubscriptionDeleted } from './subscription-deleted';

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
      billing_reason: 'subscription_create' | 'subscription_cycle';
      period_start: number;
      period_end: number;
      subscription: string;
      customer: string;
      lines: {
        data: Array<{
          price: {
            product: string;
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
      customer: string;
    };
  };
};

export default async function stripeWebhookHandler(
  dbAdapter: DBAdapter,
  request: Request,
): Promise<Response> {
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

  // For adding extra credits, we should listen for charge.succeeded, and for
  // subsciptions, we should listen for invoice.payment_succeeded (I discovered this when I was
  // testing which webhooks arrive for both types of payments)
  switch (type) {
    // These handlers should eventually become jobs which workers will process asynchronously
    case 'invoice.payment_succeeded':
      await handlePaymentSucceeded(
        dbAdapter,
        event as StripeInvoicePaymentSucceededWebhookEvent,
      );
      break;
    case 'customer.subscription.deleted': // canceled by the user, or expired due to payment failure, or payment dispute
      await handleSubscriptionDeleted(
        dbAdapter,
        event as StripeSubscriptionDeletedWebhookEvent,
      );
    case 'checkout.session.completed':
      await handleCheckoutSessionCompleted(
        dbAdapter,
        event as StripeCheckoutSessionCompletedWebhookEvent,
      );
      break;
  }

  return new Response('ok');
}
