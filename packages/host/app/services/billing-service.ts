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
import type SessionService from './session';

interface SubscriptionData {
  plan: string | null;
  creditsAvailableInPlanAllowance: number | null;
  creditsIncludedInPlanAllowance: number | null;
  extraCreditsAvailableInBalance: number | null;
  stripeCustomerId: string | null;
  stripeCustomerEmail: string | null;
  lowCreditThreshold: number | null;
  lastDailyCreditGrantAt: number | null;
  nextDailyCreditGrantAt: number | null;
  dailyCreditGrantCount: number;
}

export default class BillingService extends Service {
  @tracked private _subscriptionData: SubscriptionData | null = null;
  @tracked private _loadingSubscriptionData = false;

  @service declare private realmServer: RealmServerService;
  @service declare private network: NetworkService;
  @service declare private session: SessionService;
  @service declare private matrixService: MatrixService;

  constructor(owner: Owner) {
    super(owner);
    this.realmServer.subscribeEvent(
      'billing-notification',
      this.loadSubscriptionData.bind(this),
    );
    this.session.register(this);
  }

  resetState() {
    this._subscriptionData = null;
  }

  sessionStarted() {
    // resetState() clears the session-scoped subscription data on logout.
    // Repopulate it eagerly on re-login rather than waiting for the next
    // billing-notification push or a component re-mount. Fire-and-forget with
    // an explicit catch: the SessionService broadcast's try/catch only guards
    // synchronous throws, so an unhandled fetch rejection would otherwise
    // escape here.
    this.initializeSubscriptionData().catch((e) => {
      console.error('Failed to load subscription data on session start', e);
    });
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

  // "Ensure loaded" semantics: callers that just need subscription data to be
  // present (the session-start hook, <WithSubscriptionData/> mounts) coalesce
  // here — already-loaded data or an in-flight load satisfies them, so
  // concurrent mounts at boot share one /_user fetch. Callers reacting to a
  // change (billing-notification pushes, explicit reloads) must use
  // loadSubscriptionData(), which always fetches fresh.
  async initializeSubscriptionData() {
    if (this.subscriptionData) {
      return;
    }
    await (this.inFlightSubscriptionDataLoad ?? this.loadSubscriptionData());
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

  private inFlightSubscriptionDataLoad: Promise<void> | undefined;

  // "Fetch fresh now" semantics: always starts a new /_user request, so a
  // caller reacting to a server-side change (a billing-notification push, a
  // reload after an out-of-credits message) never gets satisfied by a response
  // that predates the change. Callers that only need the data present should
  // use initializeSubscriptionData(), which coalesces onto the load tracked
  // here.
  loadSubscriptionData(): Promise<void> {
    let load = this.fetchAndStoreSubscriptionData();
    this.inFlightSubscriptionDataLoad = load;
    // Not .finally(): that would derive a second, unhandled promise that
    // rejects alongside a failed load. The guard keeps a slow older load from
    // clearing a newer one's registration.
    let clear = () => {
      if (this.inFlightSubscriptionDataLoad === load) {
        this.inFlightSubscriptionDataLoad = undefined;
      }
    };
    load.then(clear, clear);
    return load;
  }

  private async fetchAndStoreSubscriptionData() {
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
      let lowCreditThreshold =
        json.data?.attributes?.lowCreditThreshold ?? null;
      let lastDailyCreditGrantAt =
        json.data?.attributes?.lastDailyCreditGrantAt ?? null;
      let nextDailyCreditGrantAt =
        json.data?.attributes?.nextDailyCreditGrantAt ?? null;
      let dailyCreditGrantCount =
        json.data?.attributes?.dailyCreditGrantCount ?? 0;

      this._subscriptionData = {
        plan,
        creditsAvailableInPlanAllowance,
        creditsIncludedInPlanAllowance,
        extraCreditsAvailableInBalance,
        stripeCustomerId,
        stripeCustomerEmail,
        lowCreditThreshold,
        lastDailyCreditGrantAt,
        nextDailyCreditGrantAt,
        dailyCreditGrantCount,
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
