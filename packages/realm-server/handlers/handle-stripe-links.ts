import Koa from 'koa';
import { setContextResponse } from '../middleware';

import Stripe from 'stripe';
import { SupportedMimeType } from '@cardstack/runtime-common';

type CustomerPortalLink = {
  type: 'customer-portal-link';
  id: 'customer-portal-link';
  attributes: {
    url: string;
  };
};

type FreePlanPaymentLink = {
  type: 'free-plan-payment-link';
  id: 'free-plan-payment-link';
  attributes: {
    url: string;
  };
};

type ExtraCreditsPaymentLink = {
  type: 'extra-credits-payment-link';
  id: `extra-credits-payment-link-${number}`;
  attributes: {
    url: string;
    metadata: {
      creditReloadAmount: number;
    };
  };
};

type PaymentLink =
  | CustomerPortalLink
  | FreePlanPaymentLink
  | ExtraCreditsPaymentLink;

interface APIResponse {
  data: PaymentLink[];
}

export default function handleStripeLinksRequest(): (
  ctxt: Koa.Context,
  next: Koa.Next,
) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let stripe = new Stripe(process.env.STRIPE_API_KEY!);

    let configurations = await stripe.billingPortal.configurations.list();
    if (configurations.data.length !== 1) {
      throw new Error('Expected exactly one billing portal configuration');
    }

    let configuration = configurations.data[0];
    let customerPortalLink = configuration.login_page.url;

    if (!customerPortalLink) {
      throw new Error(
        'Expected customer portal link in the billing portal configuration',
      );
    }

    let paymentLinks = await stripe.paymentLinks.list({
      active: true,
    });

    let freePlanPaymentLink = paymentLinks.data.find(
      (link) => link.metadata?.free_plan === 'true',
    );

    if (!freePlanPaymentLink) {
      throw new Error(
        'Expected free plan payment link with metadata.free_plan=true but none found',
      );
    }

    let creditTopUpPaymentLinks = paymentLinks.data.filter(
      (link) => !!link.metadata?.credit_reload_amount,
    );

    if (creditTopUpPaymentLinks.length !== 3) {
      throw new Error(
        'Expected exactly three credit top up payment links with metadata.credit_reload_amount defined but none found',
      );
    }

    let response = {
      data: [
        {
          type: 'customer-portal-link',
          id: 'customer-portal-link',
          attributes: {
            url: customerPortalLink,
          },
        },
        {
          type: 'free-plan-payment-link',
          id: 'free-plan-payment-link',
          attributes: {
            url: freePlanPaymentLink.url,
          },
        },
        ...creditTopUpPaymentLinks.map((link, index) => ({
          type: 'extra-credits-payment-link',
          id: `extra-credits-payment-link-${index}`,
          attributes: {
            url: link.url,
            metadata: {
              creditReloadAmount: parseInt(link.metadata.credit_reload_amount),
            },
          },
        })),
      ],
    } as APIResponse;

    return setContextResponse(
      ctxt,
      new Response(JSON.stringify(response), {
        headers: { 'content-type': SupportedMimeType.JSONAPI },
      }),
    );
  };
}
