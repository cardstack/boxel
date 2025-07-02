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

type PlanPaymentLink = {
  type:
    | 'starter-plan-payment-link'
    | 'creator-plan-payment-link'
    | 'power-user-plan-payment-link';
  id:
    | 'starter-plan-payment-link'
    | 'creator-plan-payment-link'
    | 'power-user-plan-payment-link';
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
  | PlanPaymentLink
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

    let starterPlanPaymentLink = paymentLinks.data.find(
      (link) => link.metadata?.plan === 'starter',
    );

    let creatorPlanPaymentLink = paymentLinks.data.find(
      (link) => link.metadata?.plan === 'creator',
    );

    let powerUserPlanPaymentLink = paymentLinks.data.find(
      (link) => link.metadata?.plan === 'power-user',
    );

    if (!starterPlanPaymentLink) {
      throw new Error(
        'Expected starter plan payment link with metadata.plan=starter but none found',
      );
    }

    if (!creatorPlanPaymentLink) {
      throw new Error(
        'Expected creator plan payment link with metadata.plan=creator but none found',
      );
    }

    if (!powerUserPlanPaymentLink) {
      throw new Error(
        'Expected power user plan payment link with metadata.plan=power-user but none found',
      );
    }

    let creditTopUpPaymentLinks = paymentLinks.data.filter(
      (link) => !!link.metadata?.credit_reload_amount,
    );

    if (creditTopUpPaymentLinks.length !== 3) {
      throw new Error(
        `Expected exactly three credit top up payment links with metadata.credit_reload_amount defined but ${creditTopUpPaymentLinks.length} found`,
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
          type: 'starter-plan-payment-link',
          id: 'starter-plan-payment-link',
          attributes: {
            url: starterPlanPaymentLink.url,
          },
        },
        {
          type: 'creator-plan-payment-link',
          id: 'creator-plan-payment-link',
          attributes: {
            url: creatorPlanPaymentLink.url,
          },
        },
        {
          type: 'power-user-plan-payment-link',
          id: 'power-user-plan-payment-link',
          attributes: {
            url: powerUserPlanPaymentLink.url,
          },
        },
        ...creditTopUpPaymentLinks.map((link, index) => ({
          type: 'extra-credits-payment-link',
          id: `extra-credits-payment-link-${index}`,
          attributes: {
            url: link.url,
            metadata: {
              creditReloadAmount: parseInt(link.metadata.credit_reload_amount),
              price: parseFloat(link.metadata.price),
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
