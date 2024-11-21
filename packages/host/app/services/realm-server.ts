import type Owner from '@ember/owner';
import Service from '@ember/service';
import { service } from '@ember/service';

import { cached } from '@glimmer/tracking';

import { restartableTask, rawTimeout, task } from 'ember-concurrency';

import window from 'ember-window-mock';

import { type IEvent } from 'matrix-js-sdk';
import { TrackedArray } from 'tracked-built-ins';

import {
  baseRealm,
  SupportedMimeType,
  Deferred,
} from '@cardstack/runtime-common';
import { RealmAuthClient } from '@cardstack/runtime-common/realm-auth-client';

import ENV from '@cardstack/host/config/environment';

import type { ExtendedClient } from './matrix-sdk-loader';
import type NetworkService from './network';
import type ResetService from './reset';

const { hostsOwnAssets, resolvedBaseRealmURL } = ENV;

export interface RealmServerTokenClaims {
  user: string;
  sessionRoom: string;
}

interface RealmServerEvent {
  eventType: string;
  data: any;
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

type RealmServerEventSubscriber = (data: any) => Promise<void>;

export default class RealmServerService extends Service {
  @service private declare network: NetworkService;
  @service private declare reset: ResetService;
  private auth: AuthStatus = { type: 'anonymous' };
  private client: ExtendedClient | undefined;
  private availableRealms = new TrackedArray<AvailableRealm>([
    { type: 'base', url: baseRealm.url },
  ]);
  private ready = new Deferred<void>();
  private eventSubscribers: Map<string, RealmServerEventSubscriber[]> =
    new Map();

  constructor(owner: Owner) {
    super(owner);
    this.reset.register(this);
    this.fetchCatalogRealms();
  }

  resetState() {
    this.logout();
  }

  setClient(client: ExtendedClient) {
    this.client = client;
    this.token =
      window.localStorage.getItem(sessionLocalStorageKey) ?? undefined;
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

  async handleEvent(event: Partial<IEvent>) {
    let claims = await this.getClaims();
    if (event.room_id !== claims.sessionRoom || !event.content) {
      return;
    }

    let realmServerEvent = JSON.parse(event.content.body) as RealmServerEvent;
    let listeners = this.eventSubscribers.get(realmServerEvent.eventType);
    listeners?.forEach(async (listener) => {
      await listener(realmServerEvent.data);
    });
  }

  subscribeEvent(eventType: string, subscriber: RealmServerEventSubscriber) {
    if (!this.eventSubscribers.has(eventType)) {
      this.eventSubscribers.set(eventType, []);
    }

    this.eventSubscribers.get(eventType)!.push(subscriber);
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

  private async getClaims() {
    if (!this.claims) {
      await this.login();
    }

    if (!this.claims) {
      throw new Error('Failed to get realm server token');
    }

    return this.claims;
  }

  private get claims(): RealmServerJWTPayload | undefined {
    if (this.auth.type === 'logged-in') {
      return this.auth.claims;
    }
    return undefined;
  }

  get token(): string | undefined {
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
  async login(): Promise<void> {
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
