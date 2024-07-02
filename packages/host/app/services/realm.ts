import { associateDestroyableChild } from '@ember/destroyable';
import { setOwner, getOwner } from '@ember/owner';
import Service from '@ember/service';

import { service } from '@ember/service';

import { waitForPromise } from '@ember/test-waiters';
import { tracked } from '@glimmer/tracking';

import { cached } from '@glimmer/tracking';

import { task, restartableTask, rawTimeout } from 'ember-concurrency';
import window from 'ember-window-mock';

import { TrackedSet } from 'tracked-built-ins';

import {
  Permissions,
  type RealmInfo,
  JWTPayload,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import { baseRealm } from '@cardstack/runtime-common/constants';

import ENV from '@cardstack/host/config/environment';

import type LoaderService from './loader-service';
import type MatrixService from './matrix-service';

const { ownRealmURL } = ENV;

interface Meta {
  info: RealmInfo;
  isPublic: boolean;
}

type AuthStatus =
  | { type: 'failed' }
  | { type: 'logged-in'; token: string; claims: JWTPayload }
  | { type: 'uninitialized' };

class RealmResource {
  @service private declare matrixService: MatrixService;
  @service declare loaderService: LoaderService;

  @tracked meta: Meta | undefined;

  @tracked
  private auth: AuthStatus = { type: 'uninitialized' };

  constructor(
    private realmURL: string,
    token: string | undefined,
  ) {
    this.token = token;
  }

  get token(): string | undefined {
    if (this.auth.type === 'logged-in') {
      return this.auth.token;
    }
    return undefined;
  }

  set token(value: string | undefined) {
    if (value) {
      this.auth = {
        type: 'logged-in',
        token: value,
        claims: claimsFromRawToken(value),
      };
    } else {
      this.auth = this.buildInitialAuthState();
    }
    SessionStorage.persist(this.realmURL, value);
    this.tokenRefresher.perform();
  }

  private buildInitialAuthState(): AuthStatus {
    if (this.realmURL === baseRealm.url) {
      // this special case is an unfortunate necessity so long as the matrix
      // service cannot start up without accessing things in the base realm.
      // The base realm is publicly-readable and nobody needs to be logged
      // into it, so always having no session is acceptable.
      return { type: 'failed' };
    }
    return { type: 'uninitialized' };
  }

  get info() {
    return this.meta?.info;
  }

  setAuthFailed() {
    this.auth = {
      type: 'failed',
    };
    SessionStorage.persist(this.realmURL, undefined);
    this.tokenRefresher.perform();
  }

  get claims(): JWTPayload | undefined {
    if (this.auth.type === 'logged-in') {
      return this.auth.claims;
    }
    return undefined;
  }

  get canRead() {
    return (
      !!this.meta?.isPublic || !!this.claims?.permissions?.includes('read')
    );
  }

  get canWrite() {
    return !!this.claims?.permissions?.includes('write');
  }

  private loggingIn: Promise<void> | undefined;

  async login(): Promise<void> {
    if (!this.loggingIn) {
      this.loggingIn = this.loginTask.perform();
    }
    await this.loggingIn;
  }

  private loginTask = task(async () => {
    try {
      let token = await this.matrixService.createRealmSession(
        new URL(this.realmURL),
      );
      this.token = token;
    } catch (e) {
      console.error('Failed to login to realm', e);
      this.setAuthFailed();
    } finally {
      this.loggingIn = undefined;
    }
  });

  logout(): void {
    this.token = undefined;
    this.loginTask.cancelAll();
    this.loggingIn = undefined;
    this.fetchMetaTask.cancelAll();
    this.fetchingMeta = undefined;
  }

  private fetchingMeta: Promise<void> | undefined;

  async fetchMeta(): Promise<void> {
    if (!this.fetchingMeta) {
      this.fetchingMeta = this.fetchMetaTask.perform();
    }
    await this.fetchingMeta;
  }

  private fetchMetaTask = task(async () => {
    try {
      if (this.meta) {
        return;
      }
      let headers: Record<string, string> = {
        Accept: SupportedMimeType.RealmInfo,
      };
      let response = await this.loaderService.loader.fetch(
        `${this.realmURL}_info`,
        {
          headers,
        },
      );
      if (response.status !== 200) {
        throw new Error(
          `Failed to fetch realm info for ${this.realmURL}: ${response.status}`,
        );
      }
      let json = await waitForPromise(response.json());
      let info: RealmInfo = {
        url: json.data.id,
        ...json.data.attributes,
      };
      let isPublic = Boolean(
        response.headers.get('x-boxel-realm-public-readable'),
      );
      this.meta = { info, isPublic };
    } finally {
      this.fetchingMeta = undefined;
    }
  });

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
    await this.login();
  });
}

export default class RealmService extends Service {
  @service declare loaderService: LoaderService;

  // This is not a TrackedMap, it's a regular Map. Conceptually, we want it to
  // be tracked, but we're using it as a read-through cache and glimmer/tracking
  // treats that case as a read-then-write assertion failure. So instead we do
  // untracked reads from `realms` and pair them, at the right times, with
  // tracked reads from `currentKnownRealms` to establish dependencies.
  private realms: Map<string, RealmResource> = this.restoreSessions();
  private currentKnownRealms = new TrackedSet<string>();

  async ensureRealmMeta(realmURL: string): Promise<void> {
    let resource = this.getOrCreateRealmResource(realmURL);
    await resource.fetchMeta();
  }

  async login(realmURL: string): Promise<void> {
    let resource = this.getOrCreateRealmResource(realmURL);
    await resource.login();
  }

  info = (url: string): RealmInfo => {
    let resource = this.knownRealm(url);
    if (!resource) {
      this.identifyRealm.perform(url);
      return {
        name: 'Unknown Realm',
        backgroundURL: null,
        iconURL: null,
      };
    }

    if (!resource.meta) {
      resource.fetchMeta();
      return {
        name: 'Unknown Realm',
        backgroundURL: null,
        iconURL: null,
      };
    } else {
      return resource.meta.info;
    }
  };

  canRead = (url: string): boolean => {
    return this.knownRealm(url)?.canRead ?? false;
  };

  canWrite = (url: string): boolean => {
    return this.knownRealm(url)?.canWrite ?? false;
  };

  permissions = (url: string): Permissions => {
    let self = this;
    return {
      get canRead() {
        return self.canRead(url);
      },
      get canWrite() {
        return self.canWrite(url);
      },
    };
  };

  meta = (url: string) => {
    let self = this;
    return {
      get info() {
        return self.info(url);
      },
      get canWrite() {
        return self.canWrite(url);
      },
    };
  };

  get allRealmsMeta() {
    const realmsMeta: Record<string, { info: RealmInfo; canWrite: boolean }> =
      Object.create(null);
    for (const [url, _resource] of this.realms.entries()) {
      realmsMeta[url] = this.meta(url);
    }
    return realmsMeta;
  }

  // Currently the personal realm has not yet been implemented,
  // until then default to the realm serving the host app if it is writable,
  // otherwise default to the first writable realm lexically
  @cached
  get userDefaultRealm(): { path: string; info: RealmInfo } {
    let writeableRealms = Object.entries(this.allRealmsMeta)
      .filter(([, i]) => i.canWrite)
      .sort(([, i], [, j]) => i.info.name.localeCompare(j.info.name));

    let ownRealm = writeableRealms.find(([url]) => url === ownRealmURL);
    if (ownRealm) {
      return { path: ownRealm[0], info: ownRealm[1].info };
    } else {
      let first = writeableRealms[0];
      return { path: first[0], info: first[1].info };
    }
  }

  token = (url: string): string | undefined => {
    return this.knownRealm(url)?.token;
  };

  logout() {
    for (let realm of this.realms.values()) {
      realm.logout();
    }
  }

  // By default, this does a tracked read from currentKnownRealms so that your
  // answer can be invalidated if a new realm is discovered. Internally, we also
  // use it untracked to implement the read-through cache.
  private knownRealm(url: string, tracked = true): RealmResource | undefined {
    for (let [key, value] of this.realms) {
      if (url.startsWith(key)) {
        return value;
      }
    }
    if (tracked) {
      this.currentKnownRealms.has(url);
    }
    return undefined;
  }

  async reauthenticate(realmURL: string): Promise<string | undefined> {
    let resource = this.getOrCreateRealmResource(realmURL);
    resource.logout();

    // TODO: decide how to identify expected login failures vs unexpected ones
    // here and catch the expected ones.
    await resource.login();

    return resource.token;
  }

  private createRealmResource(
    realmURL: string,
    token: string | undefined,
  ): RealmResource {
    let resource = new RealmResource(realmURL, token);
    setOwner(resource, getOwner(this)!);
    associateDestroyableChild(this, resource);
    return resource;
  }

  private getOrCreateRealmResource(realmURL: string): RealmResource {
    // this should be the only place we do the untracked read. It needs to be
    // untracked so our `this.realms.set` below will not be an assertion.
    let resource = this.knownRealm(realmURL, false);
    if (!resource) {
      resource = this.createRealmResource(realmURL, undefined);
      this.realms.set(realmURL, resource);
      // only after the set has happened can we safely do the tracked read to
      // establish our depenency.
      this.currentKnownRealms.add(realmURL);
    }
    return resource;
  }

  private identifyRealm = task(
    { maxConcurrency: 1, enqueue: true },
    async (url: string): Promise<void> => {
      if (this.knownRealm(url)) {
        // could have already been discovered while we were queued
        return;
      }
      let response = await this.loaderService.loader.fetch(url, {
        method: 'HEAD',
      });
      let realmURL = response.headers.get('x-boxel-realm-url');
      if (realmURL) {
        this.getOrCreateRealmResource(realmURL);
      }
    },
  );

  private restoreSessions(): Map<string, RealmResource> {
    let sessions: Map<string, RealmResource> = new Map();
    let tokens = SessionStorage.getAll();
    if (tokens) {
      for (let [realmURL, token] of Object.entries(tokens)) {
        let resource = this.createRealmResource(realmURL, token);
        sessions.set(realmURL, resource);
      }
    }
    return sessions;
  }
}

// TODO: prefer not export these but a test needs it. Can we do better?
export const tokenRefreshPeriodSec = 5 * 60; // 5 minutes
export const sessionLocalStorageKey = 'boxel-session';

export function claimsFromRawToken(rawToken: string): JWTPayload {
  let [_header, payload] = rawToken.split('.');
  return JSON.parse(atob(payload)) as JWTPayload;
}

let SessionStorage = {
  getAll(): Record<string, string> | undefined {
    let sessionsString = window.localStorage.getItem(sessionLocalStorageKey);
    if (sessionsString) {
      return JSON.parse(sessionsString);
    }
    return undefined;
  },
  persist(realmURL: string, token: string | undefined) {
    let sessionStr =
      window.localStorage.getItem(sessionLocalStorageKey) ?? '{}';
    let session = JSON.parse(sessionStr);
    if (session[realmURL] !== token) {
      session[realmURL] = token;
      window.localStorage.setItem(
        sessionLocalStorageKey,
        JSON.stringify(session),
      );
    }
  },
};
