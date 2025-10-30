import type Owner from '@ember/owner';
import Service from '@ember/service';
import { service } from '@ember/service';
import { tracked, cached } from '@glimmer/tracking';

import { formatNumber } from '@cardstack/boxel-ui/helpers';

import {
  EXTRA_TOKENS_PRICING,
  SupportedMimeType,
} from '@cardstack/runtime-common';

import type MatrixService from './matrix-service';
import type NetworkService from './network';
import type RealmServerService from './realm-server';
import type ResetService from './reset';

interface SubscriptionData {
  plan: string | null;
  creditsAvailableInPlanAllowance: number | null;
  creditsIncludedInPlanAllowance: number | null;
  extraCreditsAvailableInBalance: number | null;
  stripeCustomerId: string | null;
  stripeCustomerEmail: string | null;
}

export default class BillingService extends Service {
  @tracked private _subscriptionData: SubscriptionData | null = null;
  @tracked private _loadingSubscriptionData = false;

  @service declare private realmServer: RealmServerService;
  @service declare private network: NetworkService;
  @service declare private reset: ResetService;
  @service declare private matrixService: MatrixService;

  constructor(owner: Owner) {
    super(owner);
    this.realmServer.subscribeEvent(
      'billing-notification',
      this.loadSubscriptionData.bind(this),
    );
    this.reset.register(this);
  }

  resetState() {
    this._subscriptionData = null;
  }

  get extraCreditsPricingFormatted() {
    return Object.entries(EXTRA_TOKENS_PRICING).map(([tokens, price]) => ({
      amount: parseInt(tokens),
      amountFormatted: `${formatNumber(Number(tokens), {
        size: 'short',
      })} credits for $${formatNumber(price)}`,
    }));
  }

  redirectToStripe = async (params: {
    aiCreditAmount?: number;
    plan?: string;
  }) => {
    let { aiCreditAmount, plan } = params;
    let email = this.matrixService.profile.email!;
    let url = `${this.realmServer.url.origin}/_stripe-session`;
    let urlWithParams = new URL(url);
    urlWithParams.searchParams.set('email', email);
    urlWithParams.searchParams.set(
      'returnUrl',
      encodeURIComponent(window.location.href),
    );

    if (aiCreditAmount) {
      urlWithParams.searchParams.set(
        'aiTokenAmount',
        aiCreditAmount.toString(),
      );
    } else if (plan) {
      urlWithParams.searchParams.set('plan', plan);
    }

    let response = await this.realmServer.authedFetch(urlWithParams.href, {
      method: 'POST',
    });

    if (!response.ok) {
      console.error(response.statusText);
      return;
    }

    let data = await response.json();
    this.redirectToUrl(data.url);
  };

  // This is in a separate method so that it can be stubbed in tests
  redirectToUrl = (url: string) => {
    window.location.href = url;
  };

  @cached
  get subscriptionData() {
    return this._subscriptionData;
  }

  get loadingSubscriptionData() {
    return this._loadingSubscriptionData;
  }

  async initializeSubscriptionData() {
    if (this.subscriptionData) {
      return;
    }
    await this.loadSubscriptionData();
  }

  async fetchSubscriptionData() {
    return await this.network.fetch(`${this.url.origin}/_user`, {
      headers: {
        Accept: SupportedMimeType.JSONAPI,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await this.getToken()}`,
      },
    });
  }

  async loadSubscriptionData() {
    this._loadingSubscriptionData = true;
    try {
      let response = await this.fetchSubscriptionData();

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
      this._loadingSubscriptionData = false;
    }
  }

  get availableCredits() {
    let allAvailableCredits =
      (this.subscriptionData?.creditsAvailableInPlanAllowance ?? 0) +
      (this.subscriptionData?.extraCreditsAvailableInBalance ?? 0);

    return allAvailableCredits;
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

declare module '@ember/service' {
  interface Registry {
    'billing-service': BillingService;
  }
}
