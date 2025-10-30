import type Koa from 'koa';
import {
  EXTRA_TOKENS_PRICING,
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
import {
  getPlanByName,
  getUserByMatrixUserId,
} from '@cardstack/billing/billing-queries';
import type { RealmServerTokenClaim } from '../utils/jwt';
import type { CreateRoutesArgs } from '../routes';

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

      const stripe = getStripe();

      // Get return url from request parameters
      let returnUrl = ctxt.URL.searchParams.get('returnUrl');
      if (!returnUrl) {
        await sendResponseForBadRequest(
          ctxt,
          'returnUrl parameter is required',
        );
        return;
      }
      returnUrl = decodeURIComponent(returnUrl);

      // Get email from request parameters
      let stripeCustomerEmail =
        user.stripeCustomerEmail || ctxt.URL.searchParams.get('email');
      if (!stripeCustomerEmail) {
        await sendResponseForBadRequest(ctxt, 'email parameter is required');
        return;
      }

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

      // Check if this is a subscription request
      let planName = ctxt.URL.searchParams.get('plan');

      if (planName) {
        // Handle subscription case

        // Fetch plan from database
        const plan = await getPlanByName(dbAdapter, planName);
        if (!plan) {
          await sendResponseForBadRequest(
            ctxt,
            `Invalid plan name: ${planName}`,
          );
          return;
        }

        // Check if user already has an active subscription
        const subscriptions = await stripe.subscriptions.list({
          customer: stripeCustomerId,
          status: 'active',
          limit: 1,
        });

        if (subscriptions.data.length > 0) {
          // User has active subscription - create Customer Portal session
          const portalSession = await stripe.billingPortal.sessions.create({
            customer: stripeCustomerId,
            return_url: returnUrl,
          });

          return setContextResponse(
            ctxt,
            new Response(
              JSON.stringify({
                url: portalSession.url,
                type: 'portal',
                message:
                  'You already have an active subscription. Redirecting to manage your subscription...',
              }),
              {
                status: 200,
                headers: {
                  'content-type': SupportedMimeType.JSON,
                },
              },
            ),
          );
        }

        // Fetch the product to get the default price
        const product = await stripe.products.retrieve(plan.stripePlanId);

        // Create checkout session using the default price
        const session = await stripe.checkout.sessions.create({
          customer: stripeCustomerId,
          line_items: [
            {
              price: product.default_price as string,
              quantity: 1,
            },
          ],
          mode: 'subscription',
          success_url: returnUrl,
          cancel_url: returnUrl,
          payment_method_data: {
            allow_redisplay: 'always', // This is the important part - this is why we use a checkout session instead of payment links (to reuse payment methods previously used so that users don't have to re-enter their payment method)
          },
          metadata: {
            plan_name: planName,
            plan_id: plan.id,
            user_id: user.id,
          },
        });

        return setContextResponse(
          ctxt,
          new Response(
            JSON.stringify({
              url: session.url,
              sessionId: session.id,
              type: 'checkout',
            }),
            {
              status: 200,
              headers: {
                'content-type': SupportedMimeType.JSON,
              },
            },
          ),
        );
      }

      // Handle one-time payment case (AI tokens)
      let aiTokenAmount = ctxt.URL.searchParams.get('aiTokenAmount');
      if (!aiTokenAmount) {
        await sendResponseForBadRequest(
          ctxt,
          'Either aiTokenAmount or plan parameter is required',
        );
        return;
      }

      let priceInUsd = EXTRA_TOKENS_PRICING[parseInt(aiTokenAmount)];
      if (!priceInUsd) {
        await sendResponseForBadRequest(
          ctxt,
          `invalid aiTokenAmount. Valid values are: ${Object.keys(EXTRA_TOKENS_PRICING).join(', ')}`,
        );
        return;
      }

      // Create a Stripe Checkout Session for one-time payment
      const session = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: `${Number(aiTokenAmount).toLocaleString('en-US')} AI credits`,
              },
              unit_amount: priceInUsd * 100,
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
          allow_redisplay: 'always', // This is the important part - this is why we use a checkout session instead of payment links (to reuse payment methods previously used so that users don't have to re-enter their payment method)
        },
        metadata: {
          credit_reload_amount: aiTokenAmount,
          user_id: user.id,
        },
      });

      return setContextResponse(
        ctxt,
        new Response(
          JSON.stringify({
            url: session.url,
            sessionId: session.id,
            type: 'checkout',
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
        `Failed to create Stripe session: ${error.message}`,
      );
    }
  };
}
