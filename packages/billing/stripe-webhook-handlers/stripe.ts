import Stripe from 'stripe';

let stripe: Stripe;
export function getStripe() {
  if (!process.env.STRIPE_API_KEY) {
    throw new Error('STRIPE_API_KEY is not set');
  }

  if (!stripe) {
    stripe = new Stripe(process.env.STRIPE_API_KEY);
  }

  return stripe;
}
