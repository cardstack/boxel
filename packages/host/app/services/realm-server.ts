import Service from '@ember/service';
import { service } from '@ember/service';

import { task, restartableTask, rawTimeout } from 'ember-concurrency';

import window from 'ember-window-mock';

import { SupportedMimeType } from '@cardstack/runtime-common';
import { RealmAuthClient } from '@cardstack/runtime-common/realm-auth-client';

import type LoaderService from './loader-service';
import type { ExtendedClient } from './matrix-sdk-loader';

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

export default class RealmServerService extends Service {
  @service declare loaderService: LoaderService;
  private auth: AuthStatus = { type: 'anonymous' };
  private client: ExtendedClient | undefined;

  setClient(client: ExtendedClient) {
    this.client = client;
    this.token =
      window.localStorage.getItem(sessionLocalStorageKey) ?? undefined;
  }

  async createRealm(name: string) {
    if (!this.client) {
      throw new Error(`Cannot create realm without matrix client`);
    }
    await this.login();

    let response = await this.loaderService.loader.fetch(
      `${this.url.href}_create-realm`,
      {
        method: 'POST',
        headers: {
          Accept: SupportedMimeType.JSONAPI,
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          data: { type: 'realm', attributes: { name } },
        }),
      },
    );
    let realms =
      (await this.client.getAccountData<string[] | null>(
        'com.cardstack.boxel.realms',
      )) ?? [];
    let {
      data: { id: realmURL },
    } = (await response.json()) as { data: { id: string } };
    realms.push(realmURL);
    await this.client.setAccountData('com.cardstack.boxel.realms', realms);
    return new URL(realmURL);
  }

  logout(): void {
    this.loginTask.cancelAll();
    this.tokenRefresher.cancelAll();
    this.token = undefined;
    this.client = undefined;
    this.loggingIn = undefined;
    window.localStorage.removeItem(sessionLocalStorageKey);
  }

  private get url() {
    let url = globalThis.location.origin;
    // the ember CLI hosted app will use the dev env realm server
    // http://localhost:4201
    url === 'http://localhost:4200' ? 'http://localhost:4201' : url;
    return new URL(url);
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
        this.loaderService.loader.fetch.bind(this.loaderService.loader),
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
