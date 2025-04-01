import Owner from '@ember/owner';
import Service from '@ember/service';
import { service } from '@ember/service';
import { tracked, cached } from '@glimmer/tracking';

import { trackedFunction } from 'ember-resources/util/function';

import {
  SupportedMimeType,
  encodeWebSafeBase64,
} from '@cardstack/runtime-common';

import { formatNumber } from '../helpers/format-number';

import NetworkService from './network';
import RealmServerService from './realm-server';
import ResetService from './reset';

interface SubscriptionData {
  plan: string | null;
  creditsAvailableInPlanAllowance: number | null;
  creditsIncludedInPlanAllowance: number | null;
  extraCreditsAvailableInBalance: number | null;
  stripeCustomerId: string | null;
  stripeCustomerEmail: string | null;
}

interface StripeLink {
  type: string;
  url: string;
}

interface ExtraCreditsPaymentLink extends StripeLink {
  creditReloadAmount: number;
  price: number;
}

export default class BillingService extends Service {
  @tracked private _subscriptionData: SubscriptionData | null = null;
  @tracked private _fetchingSubscriptionData = false;

  @service declare private realmServer: RealmServerService;
  @service declare private network: NetworkService;
  @service declare private reset: ResetService;

  constructor(owner: Owner) {
    super(owner);
    this.realmServer.subscribeEvent(
      'billing-notification',
      this.fetchSubscriptionData.bind(this),
    );
    this.reset.register(this);
  }

  resetState() {
    this._subscriptionData = null;
  }

  get customerPortalLink() {
    if (!this.stripeLinks.value) {
      return undefined;
    }

    let customerPortalLink = this.stripeLinks.value?.customerPortalLink?.url;
    if (!customerPortalLink) {
      return undefined;
    }

    let stripeCustomerEmail = this.subscriptionData?.stripeCustomerEmail;
    if (!stripeCustomerEmail) {
      return customerPortalLink;
    }

    const encodedEmail = encodeURIComponent(stripeCustomerEmail);
    return `${customerPortalLink}?prefilled_email=${encodedEmail}`;
  }

  get freePlanPaymentLink() {
    return this.stripeLinks.value?.freePlanPaymentLink;
  }

  get extraCreditsPaymentLinks() {
    let links = this.stripeLinks.value
      ?.extraCreditsPaymentLinks as ExtraCreditsPaymentLink[];

    if (!links) {
      return [];
    }

    return links
      .sort((a, b) => a.creditReloadAmount - b.creditReloadAmount)
      .map((link) => ({
        ...link,
        amountFormatted: `${formatNumber(
          link.creditReloadAmount,
        )} credits for $${formatNumber(link.price)}`,
      }));
  }

  get fetchingStripePaymentLinks() {
    return this.stripeLinks.isLoading;
  }

  private stripeLinks = trackedFunction(this, async () => {
    let response = await this.network.fetch(
      `${this.url.origin}/_stripe-links`,
      {
        headers: {
          Accept: SupportedMimeType.JSONAPI,
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await this.getToken()}`,
        },
      },
    );
    if (!response.ok) {
      console.error(
        `Failed to fetch stripe payment links for realm server ${this.url.origin}: ${response.status}`,
      );
      return;
    }

    let json = (await response.json()) as {
      data: {
        type: string;
        attributes: {
          url: string;
          metadata?: {
            creditReloadAmount: number;
            price: number;
          };
        };
      }[];
    };

    let links = json.data.map((data) => ({
      type: data.type,
      url: data.attributes.url,
      creditReloadAmount: data.attributes.metadata?.creditReloadAmount,
      price: data.attributes.metadata?.price,
    })) as StripeLink[];

    return {
      customerPortalLink: links.find(
        (link) => link.type === 'customer-portal-link',
      ),
      freePlanPaymentLink: links.find(
        (link) => link.type === 'free-plan-payment-link',
      ),
      extraCreditsPaymentLinks: links.filter(
        (link) => link.type === 'extra-credits-payment-link',
      ),
    };
  });

  getStripePaymentLink(matrixUserId: string, matrixUserEmail: string): string {
    // We use the matrix user id (@username:example.com) as the client reference id for stripe
    // so we can identify the user payment in our system when we get the webhook
    // the client reference id must be alphanumeric, so we encode the matrix user id
    // https://docs.stripe.com/payment-links/url-parameters#streamline-reconciliation-with-a-url-parameter
    const clientReferenceId = encodeWebSafeBase64(matrixUserId);
    const encodedEmail = encodeURIComponent(matrixUserEmail);
    return `${this.freePlanPaymentLink?.url}?client_reference_id=${clientReferenceId}&prefilled_email=${encodedEmail}`;
  }

  @cached
  get subscriptionData() {
    return this._subscriptionData;
  }

  get fetchingSubscriptionData() {
    return this._fetchingSubscriptionData;
  }

  async fetchSubscriptionData() {
    if (this.subscriptionData) {
      return;
    }
    this._fetchingSubscriptionData = true;
    try {
      let response = await this.network.fetch(`${this.url.origin}/_user`, {
        headers: {
          Accept: SupportedMimeType.JSONAPI,
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await this.getToken()}`,
        },
      });
      if (!response.ok) {
        console.error(
          `Failed to fetch user for realm server ${this.url.origin}: ${response.status}`,
        );
        return;
      }
      let json = await response.json();
      let plan =
        json.included?.find((i: { type: string }) => i.type === 'plan')
          ?.attributes?.name ?? null;
      let creditsAvailableInPlanAllowance =
        json.data?.attributes?.creditsAvailableInPlanAllowance ?? null;
      let creditsIncludedInPlanAllowance =
        json.data?.attributes?.creditsIncludedInPlanAllowance ?? null;
      let extraCreditsAvailableInBalance =
        json.data?.attributes?.extraCreditsAvailableInBalance ?? null;
      let stripeCustomerId = json.data?.attributes?.stripeCustomerId ?? null;
      let stripeCustomerEmail =
        json.data?.attributes?.stripeCustomerEmail ?? null;
      this._subscriptionData = {
        plan,
        creditsAvailableInPlanAllowance,
        creditsIncludedInPlanAllowance,
        extraCreditsAvailableInBalance,
        stripeCustomerId,
        stripeCustomerEmail,
      };
    } finally {
      this._fetchingSubscriptionData = false;
    }
  }

  private async getToken() {
    if (!this.realmServer.token) {
      await this.realmServer.login();
    }

    if (!this.realmServer.token) {
      throw new Error('Failed to get realm server token');
    }

    return this.realmServer.token;
  }

  private get url() {
    return this.realmServer.url;
  }
}
