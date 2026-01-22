import type Owner from '@ember/owner';
import Service from '@ember/service';
import { service } from '@ember/service';

import { isTesting } from '@embroider/macros';

import { cached } from '@glimmer/tracking';

import { restartableTask, rawTimeout, task } from 'ember-concurrency';

import window from 'ember-window-mock';

import { TrackedArray } from 'tracked-built-ins';

import {
  baseRealm,
  ensureTrailingSlash,
  SupportedMimeType,
  Deferred,
  testRealmURL,
  type RealmInfo,
  type JWTPayload,
} from '@cardstack/runtime-common';
import {
  joinDMRoom,
  RealmAuthClient,
} from '@cardstack/runtime-common/realm-auth-client';

import ENV from '@cardstack/host/config/environment';
import { SessionLocalStorageKey } from '@cardstack/host/utils/local-storage-keys';

import type { ExtendedClient } from './matrix-sdk-loader';
import type NetworkService from './network';
import type RealmService from './realm';
import type ResetService from './reset';
import type { IEvent } from 'matrix-js-sdk';

const { hostsOwnAssets, resolvedBaseRealmURL } = ENV;

export interface RealmServerTokenClaims {
  user: string;
  sessionRoom: string;
}

export interface SubdomainAvailabilityResult {
  available: boolean;
  domain: string;
  error?: string;
}

export interface ClaimedDomain {
  id: string;
  hostname: string;
  subdomain: string;
  sourceRealmURL: string;
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
  @service declare private network: NetworkService;
  @service declare private reset: ResetService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;
  private auth: AuthStatus = { type: 'anonymous' };
  private client: ExtendedClient | undefined;
  private availableRealms = new TrackedArray<AvailableRealm>([
    { type: 'base', url: baseRealm.url },
  ]);
  private _ready = new Deferred<void>();
  private eventSubscribers: Map<string, RealmServerEventSubscriber[]> =
    new Map();

  constructor(owner: Owner) {
    super(owner);
    this.reset.register(this);
    this.fetchCatalogRealms();
  }

  get ready() {
    return this._ready.promise;
  }

  resetState() {
    this.logout();
  }

  setClient(client: ExtendedClient) {
    this.client = client;
    this.token =
      window.localStorage.getItem(sessionLocalStorageKey) ?? undefined;
  }

  async createStripeSession(email: string) {
    let url = new URL(`${this.url.href}_stripe-session`);
    url.searchParams.set('email', email);

    let response = await this.network.fetch(url.href, {
      method: 'POST',
      headers: {
        Accept: SupportedMimeType.JSONAPI,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
    });

    if (!response.ok) {
      let err = `Could not create Stripe session: ${response.status} - ${await response.text()}`;
      console.error(err);
      throw new Error(err);
    }

    return response;
  }

  async createUser(matrixUserId: string, registrationToken?: string) {
    await this.login();
    let response = await this.network.fetch(`${this.url.href}_user`, {
      method: 'POST',
      headers: {
        Accept: SupportedMimeType.JSONAPI,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        data: {
          type: 'user',
          attributes: {
            matrixUserId,
            registrationToken: registrationToken ?? null,
          },
        },
      }),
    });
    if (!response.ok) {
      let err = `Could not create user with parameters '${matrixUserId}' and '${registrationToken}': ${
        response.status
      } - ${await response.text()}`;
      console.error(err);
      throw new Error(err);
    }
  }

  async createRealm(args: {
    endpoint: string;
    name: string;
    iconURL?: string;
    backgroundURL?: string;
  }) {
    await this.login();

    let response = await this.network.fetch(`${this.url.href}_create-realm`, {
      method: 'POST',
      headers: {
        Accept: SupportedMimeType.JSONAPI,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        data: { type: 'realm', attributes: args },
      }),
    });
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

  async fetchTokensForAccessibleRealms() {
    await this.login();
    let response = await this.network.fetch(`${this.url.href}_realm-auth`, {
      method: 'POST',
      headers: {
        Accept: SupportedMimeType.JSONAPI,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
    });

    if (!response.ok) {
      let responseText = await response.text();

      // Temporary development instruction to help with user setup
      let isDevelopment = ENV.environment === 'development';
      if (isDevelopment && responseText.includes('User in JWT not found')) {
        console.error(
          '\x1b[1m\x1b[31m%s\x1b[0m',
          'Failed to login to realms due to missing entry in the users table. It is likely the user setup is incomplete - run pnpm register-all in matrix package',
        );
      }

      throw new Error(
        `Failed to fetch tokens for accessible realms: ${response.status} - ${responseText}`,
      );
    }

    return response.json();
  }

  @cached
  get availableRealmURLs() {
    return this.availableRealms.map((r) => r.url);
  }

  assertOwnRealmServer(realmServerURLs: string[]): void {
    let normalizedOwnRealmServerURL = this.normalizeRealmServerURL(
      this.realmServer.url.href,
    );
    let normalizedRealmServerURLs = [
      ...new Set(
        realmServerURLs.map((url) => this.normalizeRealmServerURL(url)),
      ),
    ];
    if (realmServerURLs.length === 0) {
      throw new Error(`Unable to determine realm server to use`);
    }
    if (
      normalizedRealmServerURLs.length > 1 ||
      normalizedRealmServerURLs[0] !== normalizedOwnRealmServerURL
    ) {
      throw new Error(
        `Multi-realm server support is not yet implemented: don't know how to provide auth token for different realm servers: ${normalizedRealmServerURLs.join()} (own realm server: ${normalizedOwnRealmServerURL})`,
      );
    }
  }

  getRealmServersForRealms(realms: string[]) {
    let testRealmOrigin = isTesting()
      ? new URL(testRealmURL).origin
      : undefined;
    let sessionTokens: Record<string, string> = {};
    let sessionStr =
      window.localStorage.getItem(SessionLocalStorageKey) ?? '{}';

    try {
      sessionTokens = JSON.parse(sessionStr) as Record<string, string>;
    } catch {
      sessionTokens = {};
    }

    let realmServerURLs = new Set<string>();

    for (let realmURL of realms) {
      let normalizedRealmURL = ensureTrailingSlash(realmURL);
      if (
        testRealmOrigin &&
        new URL(normalizedRealmURL).origin === testRealmOrigin
      ) {
        continue;
      }
      let token = sessionTokens[normalizedRealmURL] ?? sessionTokens[realmURL];
      if (!token) {
        continue;
      }

      let claims = realmClaimsFromRawToken(token);
      if (claims?.realmServerURL) {
        realmServerURLs.add(
          this.normalizeRealmServerURL(claims.realmServerURL),
        );
      }
    }

    if (realmServerURLs.size === 0) {
      realmServerURLs.add(this.normalizeRealmServerURL(this.url.href));
    }

    return [...realmServerURLs];
  }

  private normalizeRealmServerURL(url: string): string {
    let normalizedURL = ensureTrailingSlash(url);
    if (isTesting()) {
      let testRealmOrigin = new URL(testRealmURL).origin;
      // In tests, realm URLs are often rooted at the test realm origin but
      // are served by the base realm server; remap to the base origin so
      // federated requests hit the active test server.
      if (new URL(normalizedURL).origin === testRealmOrigin) {
        return ensureTrailingSlash(new URL(resolvedBaseRealmURL).origin);
      }
    }
    return normalizedURL;
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

  @cached
  get availableRealmIndexCardIds() {
    return this.availableRealmURLs.map((url) => `${url}index`);
  }

  async authenticateToAllAccessibleRealms() {
    let tokens = (await this.fetchTokensForAccessibleRealms()) as {
      [realmURL: string]: string;
    };

    await this.ensureJoinedSessionRoom(tokens);
    for (let [realmURL, token] of Object.entries(tokens)) {
      this.realm.getOrCreateRealmResource(realmURL, token);
    }
  }

  private async ensureJoinedSessionRoom(tokens: {
    [realmUrl: string]: string;
  }) {
    if (!this.client) {
      throw new Error(`Cannot check joined rooms without matrix client`);
    }
    let { joined_rooms } = await this.client.getJoinedRooms();
    let joinedRoomSet = new Set(joined_rooms ?? []);
    for (let [_realmURL, token] of Object.entries(tokens)) {
      let { sessionRoom } = claimsFromRawToken(token);
      if (!joinedRoomSet.has(sessionRoom)) {
        await joinDMRoom(this.client, sessionRoom);
        joinedRoomSet.add(sessionRoom);
      }
    }
  }

  async setAvailableRealmURLs(userRealmURLs: string[]) {
    await this._ready.promise;
    userRealmURLs.forEach((userRealmURL) => {
      if (!this.availableRealms.find((r) => r.url === userRealmURL)) {
        this.availableRealms.push({
          type: 'user',
          url: userRealmURL,
        });
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
    let response = await this.network.fetch(
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
        this.availableRealms.push({
          type: 'catalog',
          url: publicRealm.id,
        });
      }
    });
    this._ready.fulfill();
  }

  async fetchRealmInfos(realmUrls: string[]): Promise<{
    data: { id: string; type: 'realm-info'; attributes: RealmInfo }[];
    publicReadableRealms: Set<string>;
  }> {
    if (realmUrls.length === 0) {
      return { data: [], publicReadableRealms: new Set() };
    }

    let uniqueRealmUrls = Array.from(new Set(realmUrls));
    let realmServerURLs = this.getRealmServersForRealms(uniqueRealmUrls);
    // TODO remove this assertion after multi-realm server/federated identity is supported
    this.assertOwnRealmServer(realmServerURLs);
    let [realmServerURL] = realmServerURLs;

    await this.login();

    let infoURL = new URL('_info', realmServerURL);

    let response = await this.authedFetch(infoURL.href, {
      method: 'QUERY',
      headers: {
        Accept: SupportedMimeType.RealmInfo,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ realms: uniqueRealmUrls }),
    });

    if (!response.ok) {
      let responseText = await response.text();
      throw new Error(
        `Failed to fetch federated realm info: ${response.status} - ${responseText}`,
      );
    }

    let publicReadableRealms = new Set<string>();
    let publicReadableHeader = response.headers.get(
      'x-boxel-realms-public-readable',
    );
    if (publicReadableHeader) {
      for (let value of publicReadableHeader.split(',')) {
        let trimmed = value.trim();
        if (trimmed) {
          publicReadableRealms.add(ensureTrailingSlash(trimmed));
        }
      }
    }

    let json = (await response.json()) as {
      data: { id: string; type: 'realm-info'; attributes: RealmInfo }[];
    };
    return { data: json.data ?? [], publicReadableRealms };
  }

  async handleEvent(event: Partial<IEvent>) {
    let claims = await this.getClaims();
    if (event.room_id !== claims.sessionRoom || !event.content) {
      return;
    }

    let realmServerEvent = JSON.parse(event.content.body) as RealmServerEvent;
    let subscribers = this.eventSubscribers.get(realmServerEvent.eventType);
    subscribers?.forEach(async (subscriber) => {
      await subscriber(realmServerEvent.data);
    });
  }

  subscribeEvent(eventType: string, subscriber: RealmServerEventSubscriber) {
    if (!this.eventSubscribers.has(eventType)) {
      this.eventSubscribers.set(eventType, []);
    }

    this.eventSubscribers.get(eventType)!.push(subscriber);
  }

  get url() {
    if (isTesting()) {
      return new URL(ENV.realmServerURL);
    }

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
      throw new Error('Failed to get realm server token claims');
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
    } catch (e: any) {
      console.error(
        `RealmServerService - failed to login to realm: ${e.message}`,
        e,
      );
      this.token = undefined;
    } finally {
      this.loggingIn = undefined;
    }
  });

  async authedFetch(url: string, options: RequestInit = {}) {
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${await this.getToken()}`);

    let response = await this.network.fetch(url, {
      ...options,
      headers,
    });

    return response;
  }

  maybeAuthedFetch(url: string, options: RequestInit = {}) {
    const headers = new Headers(options.headers);
    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }
    return this.network.fetch(url, {
      ...options,
      headers,
    });
  }

  // args is of type `RequestForwardBody` in realm-server/handlers/handle-request-forward
  async requestForward(args: {
    url: string;
    method: string;
    requestBody: string;
    headers?: Record<string, string>;
    multipart?: boolean;
  }) {
    await this.login();

    const response = await this.network.fetch(
      `${this.url.href}_request-forward`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(args),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Request forward failed: ${response.status} - ${errorText}`,
      );
    }

    return response;
  }

  async registerBot(matrixUserId: string) {
    await this.login();

    let response = await this.network.fetch(
      `${this.url.href}_bot-registration`,
      {
        method: 'POST',
        headers: {
          Accept: SupportedMimeType.JSONAPI,
          'Content-Type': 'application/vnd.api+json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          data: {
            type: 'bot-registration',
            attributes: {
              matrixUserId,
            },
          },
        }),
      },
    );

    if (!response.ok) {
      let err = `Could not register bot: ${response.status} - ${await response.text()}`;
      console.error(err);
      throw new Error(err);
    }

    let body = (await response.json()) as {
      data: {
        id: string;
        attributes: {
          userId: string;
          matrixUserId: string;
          createdAt: string;
        };
      };
    };

    return {
      botRegistrationId: body.data.id,
    };
  }

  async unregisterBot(botRegistrationId: string) {
    await this.login();

    if (!botRegistrationId) {
      throw new Error('botRegistrationId is required');
    }

    let response = await this.network.fetch(
      `${this.url.href}_bot-registration`,
      {
        method: 'DELETE',
        headers: {
          Accept: SupportedMimeType.JSONAPI,
          'Content-Type': 'application/vnd.api+json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          data: {
            type: 'bot-registration',
            id: botRegistrationId,
          },
        }),
      },
    );

    if (!response.ok) {
      let err = `Could not unregister bot: ${response.status} - ${await response.text()}`;
      console.error(err);
      throw new Error(err);
    }

    return;
  }

  async getBotRegistrations() {
    await this.login();

    let response = await this.network.fetch(
      `${this.url.href}_bot-registrations`,
      {
        method: 'GET',
        headers: {
          Accept: SupportedMimeType.JSONAPI,
          Authorization: `Bearer ${this.token}`,
        },
      },
    );

    if (!response.ok) {
      let err = `Could not fetch bot registrations: ${response.status} - ${await response.text()}`;
      console.error(err);
      throw new Error(err);
    }

    let body = (await response.json()) as {
      data: Array<{
        id: string;
        attributes: {
          userId: string;
          matrixUserId: string;
          createdAt: string;
        };
      }>;
    };

    let registrations = body.data.map((entry) => ({
      botRegistrationId: entry.id,
      userId: entry.attributes.userId,
      matrixUserId: entry.attributes.matrixUserId,
      createdAt: entry.attributes.createdAt,
    }));

    return registrations;
  }

  async publishRealm(sourceRealmURL: string, publishedRealmURL: string) {
    await this.login();

    const response = await this.network.fetch(
      `${this.url.href}_publish-realm`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          sourceRealmURL,
          publishedRealmURL,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Publish realm failed: ${response.status} - ${errorText}`,
      );
    }

    return response.json();
  }

  async checkDomainAvailability(
    subdomain: string,
  ): Promise<SubdomainAvailabilityResult> {
    await this.login();

    let url = new URL(`${this.url.href}_check-boxel-domain-availability`);
    url.searchParams.set('subdomain', subdomain);

    let response = await this.realmServer.authedFetch(url.href, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      let errorText = await response.text();
      throw new Error(
        `Check site name availability failed: ${response.status} - ${errorText}`,
      );
    }

    return (await response.json()) as SubdomainAvailabilityResult;
  }

  async fetchBoxelClaimedDomain(
    sourceRealmURL: string,
  ): Promise<ClaimedDomain | null> {
    await this.login();

    let url = new URL(`${this.url.href}_boxel-claimed-domains`);
    url.searchParams.set('source_realm_url', sourceRealmURL);

    let response = await this.authedFetch(url.href, {
      method: 'GET',
      headers: {
        Accept: SupportedMimeType.JSONAPI,
      },
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      let errorText = await response.text();
      throw new Error(
        `Fetch claimed domain failed: ${response.status} - ${errorText}`,
      );
    }

    let {
      data: { id, attributes },
    } = (await response.json()) as {
      data: {
        id: string;
        attributes: {
          hostname: string;
          subdomain: string;
          sourceRealmURL: string;
        };
      };
    };

    return {
      id,
      hostname: attributes.hostname,
      subdomain: attributes.subdomain,
      sourceRealmURL: attributes.sourceRealmURL,
    };
  }

  async deleteBoxelClaimedDomain(claimedDomainId: string): Promise<void> {
    await this.login();

    let response = await this.authedFetch(
      `${this.url.href}_boxel-claimed-domains/${claimedDomainId}`,
      {
        method: 'DELETE',
      },
    );

    if (response.status === 204) {
      return;
    }

    if (!response.ok) {
      let errorText = await response.text();
      throw new Error(
        `Delete claimed domain failed: ${response.status} - ${errorText}`,
      );
    }
  }

  async claimBoxelDomain(sourceRealmURL: string, hostname: string) {
    const requestBody = {
      data: {
        type: 'claimed-domain',
        attributes: {
          source_realm_url: sourceRealmURL,
          hostname: hostname,
        },
      },
    };

    const response = await this.realmServer.authedFetch(
      `${this.url.href}_boxel-claimed-domains`,
      {
        method: 'POST',
        headers: {
          Accept: SupportedMimeType.JSONAPI,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      },
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return response.json();
  }

  async unpublishRealm(publishedRealmURL: string) {
    await this.login();

    const response = await this.network.fetch(
      `${this.url.href}_unpublish-realm`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          publishedRealmURL,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Unpublish realm failed: ${response.status} - ${errorText}`,
      );
    }

    return response.json();
  }

  async createGitHubPR(params: {
    listingName: string;
    listingId?: string;
    snapshotId: string;
    branch: string;
    baseBranch?: string;
    files: Array<{ path: string; content: string }>;
  }): Promise<{
    prUrl: string;
    prNumber: number;
    branch: string;
    sha: string;
    status: 'open' | 'merged' | 'closed' | 'failed';
  }> {
    await this.login();

    const response = await this.authedFetch(`${this.url.href}_github-pr`, {
      method: 'POST',
      headers: {
        Accept: SupportedMimeType.JSONAPI,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          type: 'github-pr',
          attributes: params,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage: string;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.errors?.[0]?.detail || errorText;
      } catch {
        errorMessage = errorText;
      }
      throw new Error(
        `GitHub PR creation failed: ${response.status} - ${errorMessage}`,
      );
    }

    const { data } = (await response.json()) as {
      data: {
        type: string;
        id: string;
        attributes: {
          prUrl: string;
          prNumber: number;
          branch: string;
          sha: string;
          status: 'open' | 'merged' | 'closed' | 'failed';
        };
      };
    };

    return data.attributes;
  }

  private async getToken() {
    if (!this.token) {
      await this.login();
    }

    if (!this.token) {
      throw new Error('Failed to get realm server token');
    }

    return this.token;
  }
}

const tokenRefreshPeriodSec = 5 * 60; // 5 minutes
const sessionLocalStorageKey = 'boxel-realm-server-session';

function claimsFromRawToken(rawToken: string): RealmServerJWTPayload {
  let [_header, payload] = rawToken.split('.');
  return JSON.parse(atob(payload)) as RealmServerJWTPayload;
}

function realmClaimsFromRawToken(rawToken: string): JWTPayload | undefined {
  try {
    let [_header, payload] = rawToken.split('.');
    return JSON.parse(atob(payload)) as JWTPayload;
  } catch {
    return undefined;
  }
}

declare module '@ember/service' {
  interface Registry {
    'realm-server': RealmServerService;
  }
}
