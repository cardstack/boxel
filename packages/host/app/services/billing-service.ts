import Owner from '@ember/owner';
import Service from '@ember/service';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { dropTask } from 'ember-concurrency';

import { SupportedMimeType } from '@cardstack/runtime-common';

import NetworkService from './network';
import RealmServerService from './realm-server';
import ResetService from './reset';

interface SubscriptionData {
  plan: string | null;
  creditsAvailableInPlanAllowance: number | null;
  creditsIncludedInPlanAllowance: number | null;
  extraCreditsAvailableInBalance: number | null;
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
    this._subscriptionData = {
      plan,
      creditsAvailableInPlanAllowance,
      creditsIncludedInPlanAllowance,
      extraCreditsAvailableInBalance,
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
