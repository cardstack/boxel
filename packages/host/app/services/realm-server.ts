import type Owner from '@ember/owner';
import Service from '@ember/service';
import { service } from '@ember/service';

import { cached, tracked } from '@glimmer/tracking';

import { restartableTask, rawTimeout, task, dropTask } from 'ember-concurrency';

import window from 'ember-window-mock';

import { MatrixEvent } from 'matrix-js-sdk';
import { TrackedArray } from 'tracked-built-ins';

import {
  baseRealm,
  SupportedMimeType,
  Deferred,
} from '@cardstack/runtime-common';
import { RealmAuthClient } from '@cardstack/runtime-common/realm-auth-client';

import ENV from '@cardstack/host/config/environment';

import { ExtendedMatrixSDK } from './matrix-sdk-loader';

import type { ExtendedClient } from './matrix-sdk-loader';
import type NetworkService from './network';
import type ResetService from './reset';

const { hostsOwnAssets, resolvedBaseRealmURL } = ENV;

interface RealmServerTokenClaims {
  user: string;
}

// iat - issued at (seconds since epoch)
// exp - expires at (seconds since epoch)
type RealmServerJWTPayload = RealmServerTokenClaims & {
  iat: number;
  exp: number;
};

type AuthStatus =
  | { type: 'logged-in'; token: string; claims: RealmServerJWTPayload }
  | { type: 'anonymous' };

interface AvailableRealm {
  url: string;
  type: 'base' | 'catalog' | 'user';
}

interface CreditInfo {
  plan: string | null;
  creditsAvailableInPlanAllowance: number | null;
  creditsIncludedInPlanAllowance: number | null;
  extraCreditsAvailableInBalance: number | null;
}

export default class RealmServerService extends Service {
  @service private declare network: NetworkService;
  @service private declare reset: ResetService;
  @tracked private _creditInfo: CreditInfo | null = null;
  private auth: AuthStatus = { type: 'anonymous' };
  private sdk: ExtendedMatrixSDK | undefined;
  private client: ExtendedClient | undefined;
  private availableRealms = new TrackedArray<AvailableRealm>([
    { type: 'base', url: baseRealm.url },
  ]);
  private ready = new Deferred<void>();
  private sessionRoomId: string | null = null;

  constructor(owner: Owner) {
    super(owner);
    this.reset.register(this);
    this.fetchCatalogRealms();
  }

  resetState() {
    this.logout();
  }

  setClientAndSDK(client: ExtendedClient, sdk: ExtendedMatrixSDK) {
    this.client = client;
    this.sdk = sdk;
    this.token =
      window.localStorage.getItem(sessionLocalStorageKey) ?? undefined;

    this.fetchCreditInfo.perform();
    this.registerCreditInfoRefresher.perform();
  }

  async createRealm(args: {
    endpoint: string;
    name: string;
    iconURL?: string;
    backgroundURL?: string;
  }) {
    if (!this.client) {
      throw new Error(`Cannot create realm without matrix client`);
    }
    await this.login();
    if (this.auth.type !== 'logged-in') {
      throw new Error('Could not login to realm server');
    }

    let response = await this.network.authedFetch(
      `${this.url.href}_create-realm`,
      {
        method: 'POST',
        headers: {
          Accept: SupportedMimeType.JSONAPI,
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          data: { type: 'realm', attributes: args },
        }),
      },
    );
    if (!response.ok) {
      let err = `Could not create realm with endpoint '${args.endpoint}': ${
        response.status
      } - ${await response.text()}`;
      console.error(err);
      throw new Error(err);
    }
    let {
      data: { id: realmURL },
    } = (await response.json()) as { data: { id: string } };
    return new URL(realmURL);
  }

  logout(): void {
    this.loginTask.cancelAll();
    this.tokenRefresher.cancelAll();
    this.token = undefined;
    this.client = undefined;
    this.loggingIn = undefined;
    this.auth = { type: 'anonymous' };
    this.availableRealms.splice(0, this.availableRealms.length, {
      type: 'base',
      url: baseRealm.url,
    });
    window.localStorage.removeItem(sessionLocalStorageKey);
  }

  @cached
  get availableRealmURLs() {
    return this.availableRealms.map((r) => r.url);
  }

  @cached
  get userRealmURLs() {
    return this.availableRealms
      .filter((r) => r.type === 'user')
      .map((r) => r.url);
  }

  @cached
  get catalogRealmURLs() {
    return this.availableRealms
      .filter((r) => r.type === 'catalog')
      .map((r) => r.url);
  }

  async setAvailableRealmURLs(userRealmURLs: string[]) {
    await this.ready.promise;
    userRealmURLs.forEach((userRealmURL) => {
      if (!this.availableRealms.find((r) => r.url === userRealmURL)) {
        this.availableRealms.push({ type: 'user', url: userRealmURL });
      }
    });

    // pluck out any user realms that aren't a part of the userRealmsURLs
    this.availableRealms
      .filter((r) => r.type === 'user')
      .forEach((realm) => {
        if (!userRealmURLs.includes(realm.url)) {
          this.availableRealms.splice(
            this.availableRealms.findIndex((r) => r.url === realm.url),
            1,
          );
        }
      });
  }

  get creditInfo() {
    return this._creditInfo;
  }

  get fetchingCreditInfo() {
    return this.fetchCreditInfo.isRunning;
  }

  async fetchCatalogRealms() {
    if (this.catalogRealmURLs.length > 0) {
      return;
    }
    let response = await this.network.authedFetch(
      `${this.url.origin}/_catalog-realms`,
    );
    if (response.status !== 200) {
      throw new Error(
        `Failed to fetch public realms for realm server ${this.url.origin}: ${response.status}`,
      );
    }

    let { data } = await response.json();
    data.forEach((publicRealm: { id: string }) => {
      if (!this.availableRealms.find((r) => r.url === publicRealm.id)) {
        this.availableRealms.push({ type: 'catalog', url: publicRealm.id });
      }
    });
    this.ready.fulfill();
  }

  get url() {
    let url;
    if (hostsOwnAssets) {
      url = new URL(resolvedBaseRealmURL).origin;
    } else {
      url = globalThis.location.origin;
    }

    return new URL(url);
  }

  private registerCreditInfoRefresher = task(async () => {
    if (!this.client || !this.sdk) {
      throw new Error(
        `Cannot register credit info refresher without matrix client or sdk`,
      );
    }

    let sessionRoomId = await this.getSessionRoomId();
    this.client.on(this.sdk.RoomEvent.Timeline, async (event: MatrixEvent) => {
      await this.client?.decryptEventIfNeeded(event);
      let content = event.getContent<{
        msgtype: string;
        body: string;
      }>();
      if (
        event.getRoomId() !== sessionRoomId ||
        event.getType() !== 'm.room.message' ||
        content?.msgtype !== 'org.boxel.realm-server-event' ||
        content?.body !== 'billing-notification'
      ) {
        return;
      }

      await this.fetchCreditInfo.perform();
    });
  });

  private fetchCreditInfo = dropTask(async () => {
    if (!this.client) {
      throw new Error(`Cannot fetch credit info without matrix client`);
    }
    await this.login();
    if (this.auth.type !== 'logged-in') {
      throw new Error('Could not login to realm server');
    }

    let response = await this.network.fetch(`${this.url.origin}/_user`, {
      headers: {
        Accept: SupportedMimeType.JSONAPI,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
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
    this._creditInfo = {
      plan,
      creditsAvailableInPlanAllowance,
      creditsIncludedInPlanAllowance,
      extraCreditsAvailableInBalance,
    };
  });

  private async getSessionRoomId(): Promise<string> {
    if (!this.client) {
      throw new Error(`Cannot get session room id without matrix client`);
    }

    if (!this.sessionRoomId) {
      let userId = this.client.getUserId();
      if (!userId) {
        throw new Error('userId is undefined');
      }
      let response = await this.network.fetch(
        `${this.url.href}_server-session`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
          },
          body: JSON.stringify({
            user: userId,
          }),
        },
      );

      if (response.status !== 401) {
        throw new Error(
          `unexpected response from POST ${this.url.href}_server-session
          }: ${response.status} - ${await response.text()}`,
        );
      }
      this.sessionRoomId = (await response.json()).room as string;
    }

    return this.sessionRoomId;
  }

  private get claims(): RealmServerJWTPayload | undefined {
    if (this.auth.type === 'logged-in') {
      return this.auth.claims;
    }
    return undefined;
  }

  private get token(): string | undefined {
    if (this.auth.type === 'logged-in') {
      return this.auth.token;
    }
    return undefined;
  }

  private set token(value: string | undefined) {
    if (value) {
      this.auth = {
        type: 'logged-in',
        token: value,
        claims: claimsFromRawToken(value),
      };
    } else {
      this.auth = { type: 'anonymous' };
    }
    window.localStorage.setItem(sessionLocalStorageKey, value ?? '');
    this.tokenRefresher.perform();
  }

  private tokenRefresher = restartableTask(async () => {
    if (!this.claims) {
      return;
    }

    // token expiration is unix time (seconds)
    let expirationMs = this.claims.exp * 1000;

    let refreshMs = Math.max(
      expirationMs - Date.now() - tokenRefreshPeriodSec * 1000,
      0,
    );

    await rawTimeout(refreshMs);
    if (!this.loggingIn) {
      this.loggingIn = this.loginTask.perform();
      await this.loggingIn;
    }
  });

  private loggingIn: Promise<void> | undefined;

  // login happens lazily as you need to interact with realm server which
  // currently only constitutes creating realms
  private async login(): Promise<void> {
    if (this.auth.type === 'logged-in') {
      return;
    }
    if (!this.loggingIn) {
      this.loggingIn = this.loginTask.perform();
    }
    await this.loggingIn;
  }

  private loginTask = task(async () => {
    if (!this.client) {
      throw new Error(`Cannot login to realm server without matrix client`);
    }
    try {
      let realmAuthClient = new RealmAuthClient(
        this.url,
        this.client,
        this.network.authedFetch.bind(this.network),
        {
          authWithRealmServer: true,
        },
      );
      let token = await realmAuthClient.getJWT();
      this.token = token;
    } catch (e) {
      console.error('Failed to login to realm', e);
      this.token = undefined;
    } finally {
      this.loggingIn = undefined;
    }
  });
}

const tokenRefreshPeriodSec = 5 * 60; // 5 minutes
const sessionLocalStorageKey = 'boxel-realm-server-session';

function claimsFromRawToken(rawToken: string): RealmServerJWTPayload {
  let [_header, payload] = rawToken.split('.');
  return JSON.parse(atob(payload)) as RealmServerJWTPayload;
}
