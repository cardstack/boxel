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
  publishRealm as publishRealmOperation,
  SupportedMimeType,
  Deferred,
  ri,
  testRealmURL,
  unpublishRealm as unpublishRealmOperation,
  type RealmClient,
  type RealmIdentifier,
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
  hostname: string;
  // Validation message when the subdomain is rejected (e.g. punycode); absent
  // when the name is simply already taken.
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

  get canFetch(): boolean {
    return this.client !== undefined || this.auth.type === 'logged-in';
  }

  resetState() {
    let catalogRealms = this.availableRealms.filter(
      (realm) => realm.type === 'catalog',
    );
    this.logout();
    this.availableRealms = new TrackedArray([
      { type: 'base', url: baseRealm.url },
      ...catalogRealms,
    ]);
    this.eventSubscribers = new Map();
    this._ready = new Deferred<void>();
    this._ready.fulfill();
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

  async deleteRealm(realmURL: string) {
    await this.login();

    let response = await this.network.fetch(`${this.url.href}_delete-realm`, {
      method: 'DELETE',
      headers: {
        Accept: SupportedMimeType.JSONAPI,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        data: {
          type: 'realm',
          id: realmURL,
        },
      }),
    });

    if (!response.ok) {
      let err = `Could not delete realm '${realmURL}': ${
        response.status
      } - ${await response.text()}`;
      console.error(err);
      throw new Error(err);
    }
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

  // Boot assembly reads `app.boxel.realm-servers` and asks each trusted
  // server (via `_realm-auth`) which realms the current user has. Returns
  // the union of realm URLs across all trusted servers. assertOwnRealmServer()
  // keeps the single-server invariant — it rejects any list that includes a
  // server other than the user's own until multi-realm-server federation
  // ships.
  async fetchUserRealmsFromTrustedServers(
    trustedServerURLs: string[],
  ): Promise<string[]> {
    if (trustedServerURLs.length === 0) {
      return [];
    }
    // TODO: remove once multi-realm-server federation lands.
    this.assertOwnRealmServer(trustedServerURLs);
    await this.login();
    let perServerRealmURLs = await Promise.all(
      trustedServerURLs.map(async (serverURL) => {
        let normalizedServerURL = ensureTrailingSlash(serverURL);
        let response = await this.network.fetch(
          `${normalizedServerURL}_realm-auth`,
          {
            method: 'POST',
            headers: {
              Accept: SupportedMimeType.JSONAPI,
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.token}`,
            },
          },
        );
        if (!response.ok) {
          let responseText = await response.text();
          throw new Error(
            `Failed to fetch user realms from trusted server ${normalizedServerURL}: ${response.status} - ${responseText}`,
          );
        }
        let tokens = (await response.json()) as Record<string, string>;
        return Object.keys(tokens);
      }),
    );
    return [...new Set(perServerRealmURLs.flat())];
  }

  @cached
  get availableRealmIdentifiers(): RealmIdentifier[] {
    return this.availableRealms.map((r) => ri(r.url));
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
    let sessionTokens = this.readSessionTokens();

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

  // Derives the distinct realm-server URLs backing the given realm URLs.
  // Used by the one-time host-boot migration that seeds
  // `app.boxel.realm-servers` from the legacy `app.boxel.realms` list. A
  // realm's server is the origin of its URL; when a session token for that
  // realm is present its `realmServerURL` claim is authoritative and taken
  // as a cross-check over the bare origin. Results run through the same
  // normalization as the rest of the service, so the distinct origins that
  // back a single server (e.g. the test-realm origin and the base realm
  // origin in tests) collapse to that one server.
  deriveRealmServerURLsForRealms(realms: string[]): string[] {
    let sessionTokens = this.readSessionTokens();
    let realmServerURLs = new Set<string>();
    for (let realmURL of realms) {
      let normalizedRealmURL = ensureTrailingSlash(realmURL);
      let token = sessionTokens[normalizedRealmURL] ?? sessionTokens[realmURL];
      let claims = token ? realmClaimsFromRawToken(token) : undefined;
      let realmServerURL =
        claims?.realmServerURL ?? new URL(normalizedRealmURL).origin;
      realmServerURLs.add(this.normalizeRealmServerURL(realmServerURL));
    }
    return [...realmServerURLs];
  }

  private readSessionTokens(): Record<string, string> {
    let sessionStr =
      window.localStorage.getItem(SessionLocalStorageKey) ?? '{}';
    try {
      return JSON.parse(sessionStr) as Record<string, string>;
    } catch {
      return {};
    }
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
  get userRealmIdentifiers(): RealmIdentifier[] {
    return this.availableRealms
      .filter((r) => r.type === 'user')
      .map((r) => ri(r.url));
  }

  @cached
  get catalogRealmIdentifiers(): RealmIdentifier[] {
    return this.availableRealms
      .filter((r) => r.type === 'catalog')
      .map((r) => ri(r.url));
  }

  @cached
  get displayedCatalogRealmIdentifiers(): RealmIdentifier[] {
    return this.catalogRealmIdentifiers;
  }

  @cached
  get availableRealmIndexCardIds() {
    return this.availableRealmIdentifiers.map((url) => `${url}index`);
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

  async setAvailableRealmIdentifiers(userRealmIdentifiers: RealmIdentifier[]) {
    await this._ready.promise;
    userRealmIdentifiers.forEach((userRealmIdentifier) => {
      if (!this.availableRealms.find((r) => r.url === userRealmIdentifier)) {
        this.availableRealms.push({
          type: 'user',
          url: userRealmIdentifier,
        });
      }
    });

    // pluck out any user realms that aren't a part of userRealmIdentifiers
    this.availableRealms
      .filter((r) => r.type === 'user')
      .forEach((realm) => {
        if (!userRealmIdentifiers.includes(ri(realm.url))) {
          this.availableRealms.splice(
            this.availableRealms.findIndex((r) => r.url === realm.url),
            1,
          );
        }
      });
  }

  async fetchCatalogRealms() {
    if (this.catalogRealmIdentifiers.length > 0) {
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

    let infoURL = new URL('_federated-info', realmServerURL);

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

  async fetchCardTypeSummaries(
    realmUrls: string[],
    options?: {
      searchKey?: string;
      page?: { number: number; size: number };
    },
  ): Promise<{
    data: {
      id: string;
      type: 'card-type-summary';
      attributes: {
        displayName: string;
        total: number;
        iconHTML: string;
        // The federated `_types` response now stamps `kind` on every
        // entry. Keeping it in the declared return type — not just the
        // local `json` cast — means callers see the discriminator and
        // can partition card vs file summaries instead of conflating
        // them. `?` for back-compat with the still-supported legacy
        // response shape (no kind, treated as 'instance').
        kind?: 'instance' | 'file';
      };
      meta?: { realmURL: string };
    }[];
    meta: { page: { total: number } };
  }> {
    if (realmUrls.length === 0) {
      return { data: [], meta: { page: { total: 0 } } };
    }

    let uniqueRealmUrls = Array.from(new Set(realmUrls));
    let realmServerURLs = this.getRealmServersForRealms(uniqueRealmUrls);
    // TODO remove this assertion after multi-realm server/federated identity is supported
    this.assertOwnRealmServer(realmServerURLs);
    let [realmServerURL] = realmServerURLs;

    await this.login();

    let typesURL = new URL('_federated-types', realmServerURL);

    let body: Record<string, unknown> = { realms: uniqueRealmUrls };
    if (options?.searchKey) {
      body.searchKey = options.searchKey;
    }
    if (options?.page) {
      body.page = options.page;
    }

    let response = await this.authedFetch(typesURL.href, {
      method: 'QUERY',
      headers: {
        Accept: SupportedMimeType.CardTypeSummary,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let responseText = await response.text();
      throw new Error(
        `Failed to fetch federated card type summaries: ${response.status} - ${responseText}`,
      );
    }

    let json = (await response.json()) as {
      data: {
        id: string;
        type: 'card-type-summary';
        attributes: {
          displayName: string;
          total: number;
          iconHTML: string;
          kind?: 'instance' | 'file';
        };
        meta?: { realmURL: string };
      }[];
      meta: { page: { total: number } };
    };
    return { data: json.data ?? [], meta: json.meta ?? { page: { total: 0 } } };
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
  private pendingRegistrationToken: string | undefined;

  async login(registrationToken?: string): Promise<void> {
    if (registrationToken) {
      this.pendingRegistrationToken = registrationToken;
    }
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
          registrationToken: this.pendingRegistrationToken,
        },
      );
      this.pendingRegistrationToken = undefined;
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

  maybeAuthedFetchForRealms(
    url: string,
    realms: string[],
    options: RequestInit = {},
  ) {
    const headers = new Headers(options.headers);
    if (!headers.has('Authorization')) {
      if (this.token) {
        headers.set('Authorization', `Bearer ${this.token}`);
      } else {
        let realmToken = this.getRealmTokenForRealms(realms);
        if (realmToken) {
          headers.set('Authorization', `Bearer ${realmToken}`);
        }
      }
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

  async registerBot(username: string) {
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
              username,
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
          username: string;
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
          username: string;
          createdAt: string;
        };
      }>;
    };

    let registrations = body.data.map((entry) => ({
      botRegistrationId: entry.id,
      username: entry.attributes.username,
      createdAt: entry.attributes.createdAt,
    }));

    return registrations;
  }

  // Adapts this service's realm-server auth/config into the portable
  // `RealmClient` the shared realm operations consume. Operations issued here
  // only hit realm-server endpoints, so a single `authedFetch` carrying the
  // realm-server token suffices.
  private get realmClient(): RealmClient {
    return {
      realmServerURL: ensureTrailingSlash(this.url.href),
      config: {
        spaceDomain: ENV.publishedRealmBoxelSpaceDomain,
        siteDomain: ENV.publishedRealmBoxelSiteDomain,
      },
      authedFetch: (url, init) => this.authedFetch(url, init),
    };
  }

  async publishRealm(sourceRealmURL: string, publishedRealmURL: string) {
    await this.login();
    return publishRealmOperation(this.realmClient, {
      sourceRealmURL,
      publishedRealmURL,
    });
  }

  async unpublishRealm(publishedRealmURL: string) {
    await this.login();
    return unpublishRealmOperation(this.realmClient, { publishedRealmURL });
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

  // Asks the server for this realm's unlisted-link path segment, allocating a
  // fresh server-generated one when none exists (or when `regenerate` is set).
  // The slug is always determined by the server so it can't be hand-picked.
  async allocateUnlistedPath(
    sourceRealmURL: string,
    options: { regenerate?: boolean } = {},
  ): Promise<{ sourceRealmURL: string; slug: string }> {
    await this.login();

    let response = await this.authedFetch(
      `${this.url.href}_unlisted-realm-path`,
      {
        method: 'POST',
        headers: {
          Accept: SupportedMimeType.JSONAPI,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sourceRealmURL,
          regenerate: options.regenerate ?? false,
        }),
      },
    );

    if (!response.ok) {
      let errorText = await response.text();
      throw new Error(
        `Allocate unlisted link failed: ${response.status} - ${errorText}`,
      );
    }

    let {
      data: { attributes },
    } = (await response.json()) as {
      data: { attributes: { sourceRealmURL: string; slug: string } };
    };
    return { sourceRealmURL: attributes.sourceRealmURL, slug: attributes.slug };
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
          hostname,
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

  private getRealmTokenForRealms(realms: string[]): string | undefined {
    let sessionTokens = this.readSessionTokens();
    for (let realmURL of realms) {
      let normalizedRealmURL = ensureTrailingSlash(realmURL);
      let token = sessionTokens[normalizedRealmURL] ?? sessionTokens[realmURL];
      if (token) {
        return token;
      }
    }
    return undefined;
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
