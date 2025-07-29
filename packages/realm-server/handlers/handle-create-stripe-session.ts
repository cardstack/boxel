import Koa from 'koa';
import {
  SupportedMimeType,
  asExpressions,
  param,
  query,
  update,
} from '@cardstack/runtime-common';
import {
  setContextResponse,
  sendResponseForBadRequest,
  sendResponseForSystemError,
  sendResponseForNotFound,
} from '../middleware';
import { getStripe } from '@cardstack/billing/stripe-webhook-handlers/stripe';
import { getUserByMatrixUserId } from '@cardstack/billing/billing-queries';
import { RealmServerTokenClaim } from '../utils/jwt';
import { CreateRoutesArgs } from '../routes';

export default function handleCreateStripeSessionRequest({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    try {
      let token = ctxt.state.token as RealmServerTokenClaim;
      if (!token) {
        await sendResponseForSystemError(
          ctxt,
          'token is required to fetch user',
        );
        return;
      }

      let { user: matrixUserId } = token;
      let user = await getUserByMatrixUserId(dbAdapter, matrixUserId);
      if (!user) {
        await sendResponseForNotFound(ctxt, 'user is not found');
        return;
      }

      // Get return url from request parameters
      let returnUrl = ctxt.URL.searchParams.get('returnUrl');
      if (!returnUrl) {
        await sendResponseForBadRequest(
          ctxt,
          'returnUrl parameter is required',
        );
        return;
      }

      // Get email from request parameters
      let stripeCustomerEmail =
        user.stripeCustomerEmail || ctxt.URL.searchParams.get('email');
      if (!stripeCustomerEmail) {
        await sendResponseForBadRequest(ctxt, 'email parameter is required');
        return;
      }

      // Get AI token amount from request parameters
      let aiTokenAmount = ctxt.URL.searchParams.get('aiTokenAmount');
      if (!aiTokenAmount) {
        await sendResponseForBadRequest(
          ctxt,
          'aiTokenAmount parameter is required',
        );
        return;
      }

      let tokensToPriceMap: Record<number, number> = {
        2500: 5,
        20000: 30,
        80000: 100,
      }; // 2500 tokens for $5, 20000 tokens for $30, 80000 tokens for $100

      let priceInUsd = tokensToPriceMap[parseInt(aiTokenAmount)];
      if (!priceInUsd) {
        await sendResponseForBadRequest(
          ctxt,
          `invalid aiTokenAmount. Valid values are: ${Object.keys(tokensToPriceMap).join(', ')}`,
        );
        return;
      }

      const stripe = getStripe();

      // If user has customer id, use it, otherwise create a new one
      let stripeCustomerId = user.stripeCustomerId;
      if (!stripeCustomerId) {
        const customer = await stripe.customers.create({
          email: stripeCustomerEmail,
        });
        stripeCustomerId = customer.id;

        let { valueExpressions, nameExpressions } = asExpressions({
          stripe_customer_id: stripeCustomerId,
          stripe_customer_email: customer.email,
        });
        await query(dbAdapter, [
          ...update('users', nameExpressions, valueExpressions),
          ` WHERE id = `,
          param(user.id),
        ]);
      }

      // Create a Stripe Checkout Session
      const session = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: `${aiTokenAmount} AI credits`,
              },
              unit_amount: priceInUsd * 100, // Must be in cents
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: returnUrl,
        cancel_url: returnUrl,
        payment_intent_data: {
          setup_future_usage: 'off_session',
        },
        payment_method_data: {
          allow_redisplay: 'always',
        },
        metadata: {
          credit_reload_amount: aiTokenAmount,
          user_id: user.id,
        },
      });

      // Return the session URL in a response for frontend to handle redirect to the checkout form
      return setContextResponse(
        ctxt,
        new Response(
          JSON.stringify({
            url: session.url,
            sessionId: session.id,
          }),
          {
            status: 200,
            headers: {
              'content-type': SupportedMimeType.JSON,
            },
          },
        ),
      );
    } catch (error: any) {
      await sendResponseForBadRequest(
        ctxt,
        `Failed to create Stripe checkout session: ${error.message}`,
      );
    }
  };
}
