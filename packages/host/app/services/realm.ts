import { associateDestroyableChild } from '@ember/destroyable';
import { setOwner, getOwner } from '@ember/owner';
import Service from '@ember/service';

import { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import { cached } from '@glimmer/tracking';

import { task, restartableTask, rawTimeout } from 'ember-concurrency';

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
      this.auth = { type: 'uninitialized' };
    }
    SessionStorage.persist(this.realmURL, value);
    this.tokenRefresher.perform();
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
      if (this.auth.type === 'uninitialized') {
        if (this.realmURL === baseRealm.url) {
          this.setAuthFailed();
        } else {
          await this.login();
        }
      }
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
      let json = await response.json();
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

// private loginAttempter = restartableTask(async () => {
//   // if
// });

class RealmNotReadyError extends Error {
  code = 'RealmNotReady';
}
export default class RealmService extends Service {
  @service declare loaderService: LoaderService;

  private realms: Map<string, RealmResource> = this.restoreSessions();

  async ensureRealmMeta(realmURL: string): Promise<void> {
    let resource = this.knownRealm(realmURL);
    if (!resource) {
      resource = this.createRealmResource(realmURL, undefined);
      this.realms.set(realmURL, resource);
    }
    await resource.fetchMeta();
  }

  info = (url: string): RealmInfo => {
    return this.requireRealmMeta(url).meta.info;
  };

  canRead = (url: string): boolean => {
    return this.requireRealmMeta(url).canRead;
  };

  canWrite = (url: string): boolean => {
    return this.requireRealmMeta(url).canWrite;
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
    const realmsMeta: { info: RealmInfo; canWrite: boolean }[] = [];
    for (const [url, _resource] of this.realms.entries()) {
      realmsMeta.push(this.meta(url));
    }
    return realmsMeta;
  }

  // Currently the personal realm has not yet been implemented,
  // until then default to the realm serving the host app if it is writable,
  // otherwise default to the first writable realm lexically
  @cached
  get userDefaultRealm(): { path: string; info: RealmInfo } {
    let writeableRealms = this.allRealmsMeta
      .filter((i) => i.canWrite)
      .sort((i, j) => i.info.name.localeCompare(j.info.name));

    let ownRealm = writeableRealms.find((i) => i.info.url === ownRealmURL);
    if (ownRealm) {
      return { path: ownRealm.info.url, info: ownRealm.info };
    } else {
      let first = writeableRealms[0];
      return { path: first.info.url, info: first.info };
    }
  }

  token = (url: string): string | undefined => {
    return this.knownRealm(url)?.token;
  };

  private requireRealmMeta(url: string): RealmResource & { meta: Meta } {
    let resource = this.knownRealm(url);
    if (!resource) {
      throw new RealmNotReadyError(
        `Haven't fetched from realm at ${url} yet, so realm info is not available`,
      );
    }
    if (!resource.meta) {
      throw new RealmNotReadyError(
        `Haven't fetched from realm at ${url} yet, so realm info is not available`,
      );
    }
    return resource as RealmResource & { meta: Meta };
  }

  private knownRealm(url: string): RealmResource | undefined {
    for (let [key, value] of this.realms) {
      if (url.startsWith(key)) {
        return value;
      }
    }
    return undefined;
  }

  async reauthenticate(realmURL: string): Promise<string | undefined> {
    let resource = this.knownRealm(realmURL);
    if (!resource) {
      resource = this.createRealmResource(realmURL, undefined);
      this.realms.set(realmURL, resource);
    }
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

// TODO: callers of this expect to clear everything -- this should probably be done by logging out of all known realms
export function clearAllRealmSessions() {
  window.localStorage.removeItem(sessionLocalStorageKey);
  // for (let [realm, timeout] of sessionExpirations.entries()) {
  //   clearTimeout(timeout);
  //   sessionExpirations.delete(realm);
  // }
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
