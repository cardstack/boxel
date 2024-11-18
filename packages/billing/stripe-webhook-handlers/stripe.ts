import Stripe from 'stripe';

let stripe: Stripe;
// Need to export this function so the stripe instance can be mocked in test
export function getStripe() {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  }

  if (!stripe) {
    stripe = new Stripe(process.env.STRIPE_WEBHOOK_SECRET);
  }

  return stripe;
}
