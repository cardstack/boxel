import Owner from '@ember/owner';
import Service from '@ember/service';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { dropTask } from 'ember-concurrency';

import window from 'ember-window-mock';

import { SupportedMimeType } from '@cardstack/runtime-common';

import NetworkService from './network';
import RealmServerService from './realm-server';
import ResetService from './reset';

interface SubscriptionData {
  plan: string | null;
  creditsAvailableInPlanAllowance: number | null;
  creditsIncludedInPlanAllowance: number | null;
  extraCreditsAvailableInBalance: number | null;
  stripeCustomerId: string | null;
}

interface StripeLink {
  type: string;
  url: string;
  creditReloadAmount?: number;
}

export default class BillingService extends Service {
  @tracked private _subscriptionData: SubscriptionData | null = null;
  @tracked private _stripeLinks: StripeLink[] | null = null;
  private _fetchingSubscriptionData: Promise<void> | null = null;
  private _fetchingStripeLinks: Promise<void> | null = null;

  @service private declare realmServer: RealmServerService;
  @service private declare network: NetworkService;
  @service private declare reset: ResetService;

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
    this._stripeLinks = null;
  }

  async managePlan() {
    await this.fetchStripeLinks();
    let customerPortalLink = this.stripeLinks?.find(
      (link) => link.type === 'customer-portal-link',
    );
    if (!customerPortalLink) {
      throw new Error('customer portal link is not found');
    }
    window.open(customerPortalLink.url);
  }

  async fetchStripeLinks() {
    if (!this._fetchingStripeLinks) {
      this._fetchingStripeLinks = this.fetchStripeLinksTask.perform();
    }
    await this._fetchingStripeLinks;
  }

  get stripeLinks() {
    return this._stripeLinks;
  }

  private fetchStripeLinksTask = dropTask(async () => {
    try {
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
      if (response.status !== 200) {
        throw new Error(
          `Failed to fetch user for realm server ${this.url.origin}: ${response.status}`,
        );
      }

      let json = (await response.json()) as {
        data: {
          type: string;
          attributes: {
            url: string;
            metadata?: { creditReloadAmount: number };
          };
        }[];
      };
      this._stripeLinks = json.data.map((data) => ({
        type: data.type,
        url: data.attributes.url,
        creditReloadAmount: data.attributes.metadata?.creditReloadAmount,
      }));
    } finally {
      this._fetchingStripeLinks = null;
    }
  });

  encodeToAlphanumeric(matrixUserId: string) {
    return Buffer.from(matrixUserId)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  async getStripePaymentLink(matrixUserId: string): Promise<string> {
    // We use the matrix user id (@username:example.com) as the client reference id for stripe
    // so we can identify the user payment in our system when we get the webhook
    // the client reference id must be alphanumeric, so we encode the matrix user id
    // https://docs.stripe.com/payment-links/url-parameters#streamline-reconciliation-with-a-url-parameter
    await this.fetchStripeLinks();
    let freePaymentLink = this._stripeLinks?.find(
      (link) => link.type === 'free-plan-payment-link',
    );
    if (!freePaymentLink) {
      throw new Error('free payment link is not found');
    }
    const clientReferenceId = this.encodeToAlphanumeric(matrixUserId);
    return `${freePaymentLink}?client_reference_id=${clientReferenceId}`;
  }

  get subscriptionData() {
    return this._subscriptionData;
  }

  get fetchingSubscriptionData() {
    return !!this._fetchingSubscriptionData;
  }

  async fetchSubscriptionData() {
    if (!this._fetchingSubscriptionData) {
      this._fetchingSubscriptionData = this.fetchSubscriptionDataTask.perform();
    }
    await this._fetchingSubscriptionData;
  }

  private fetchSubscriptionDataTask = dropTask(async () => {
    try {
      let response = await this.network.fetch(`${this.url.origin}/_user`, {
        headers: {
          Accept: SupportedMimeType.JSONAPI,
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await this.getToken()}`,
        },
      });
      if (response.status !== 200) {
        throw new Error(
          `Failed to fetch user for realm server ${this.url.origin}: ${response.status}`,
        );
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
      this._subscriptionData = {
        plan,
        creditsAvailableInPlanAllowance,
        creditsIncludedInPlanAllowance,
        extraCreditsAvailableInBalance,
        stripeCustomerId,
      };
    } finally {
      this._fetchingSubscriptionData = null;
    }
  });

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
