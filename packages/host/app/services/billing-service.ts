import Owner from '@ember/owner';
import Service from '@ember/service';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { dropTask } from 'ember-concurrency';

import { SupportedMimeType } from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';

import NetworkService from './network';
import RealmServerService from './realm-server';
import ResetService from './reset';

const { stripePaymentLink } = ENV;

interface SubscriptionData {
  plan: string | null;
  creditsAvailableInPlanAllowance: number | null;
  creditsIncludedInPlanAllowance: number | null;
  extraCreditsAvailableInBalance: number | null;
  stripeCustomerId: string | null;
}

export default class BillingService extends Service {
  @tracked private _subscriptionData: SubscriptionData | null = null;

  @service private declare realmServer: RealmServerService;
  @service private declare network: NetworkService;
  @service private declare reset: ResetService;

  constructor(owner: Owner) {
    super(owner);
    this.realmServer.subscribeEvent(
      'billing-notification',
      this.subscriptionDataRefresher.bind(this),
    );
    this.reset.register(this);
  }

  resetState() {
    this._subscriptionData = null;
  }

  encodeToAlphanumeric(matrixUserId: string) {
    return Buffer.from(matrixUserId)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  getStripePaymentLink(matrixUserId: string): string {
    // We use the matrix user id (@username:example.com) as the client reference id for stripe
    // so we can identify the user payment in our system when we get the webhook
    // the client reference id must be alphanumeric, so we encode the matrix user id
    // https://docs.stripe.com/payment-links/url-parameters#streamline-reconciliation-with-a-url-parameter
    const clientReferenceId = this.encodeToAlphanumeric(matrixUserId);
    return `${stripePaymentLink}?client_reference_id=${clientReferenceId}`;
  }

  get subscriptionData() {
    return this._subscriptionData;
  }

  get fetchingSubscriptionData() {
    return this.fetchSubscriptionDataTask.isRunning;
  }

  async fetchSubscriptionData() {
    if (this.subscriptionData) {
      return;
    }
    await this.fetchSubscriptionDataTask.perform();
  }

  private async subscriptionDataRefresher() {
    await this.fetchSubscriptionDataTask.perform();
  }

  private fetchSubscriptionDataTask = dropTask(async () => {
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
