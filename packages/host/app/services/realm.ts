import {
  isDestroyed,
  isDestroying,
  registerDestructor,
} from '@ember/destroyable';
import { setOwner, getOwner } from '@ember/owner';
import type Owner from '@ember/owner';
import Service from '@ember/service';

import { service } from '@ember/service';

import { buildWaiter } from '@ember/test-waiters';

import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';

import {
  Permissions,
  type RealmInfo,
  JWTPayload,
  SupportedMimeType,
} from '@cardstack/runtime-common';

import type LoaderService from './loader-service';
import type MatrixService from './matrix-service';

const waiter = buildWaiter('realm-service');

interface Meta {
  info: RealmInfo;
  isPublic: boolean;
}

class RealmResource {
  @service private declare matrixService: MatrixService;
  @service declare loaderService: LoaderService;

  @tracked meta: Meta | undefined;

  @tracked
  private auth: { token: string; claims: JWTPayload } | undefined;

  private sessionExpirationTimeout: number | undefined;

  constructor(
    private realmURL: string,
    auth: { token: string; claims: JWTPayload } | undefined,
  ) {
    this.auth = auth;
    if (auth) {
      SessionStorage.persist(this.realmURL, auth.token);
      this.scheduleSessionRefresh();
    }
    registerDestructor(this, this.cleanup);
  }

  get token(): string | undefined {
    return this.auth?.token;
  }

  get claims(): JWTPayload | undefined {
    return this.auth?.claims;
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
    let token = await this.matrixService.createRealmSession(
      new URL(this.realmURL),
    );
    let claims = claimsFromRawToken(token);
    this.auth = { claims, token };
    SessionStorage.persist(this.realmURL, token);
    this.loggingIn = undefined;
  });

  logout(): void {
    this.auth = undefined;
    clearTimeout(this.sessionExpirationTimeout);
    SessionStorage.remove(this.realmURL);
  }

  async fetchMeta(): Promise<void> {
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
  }

  // TODO: can probably delete this once middleware no longer uses it
  async refreshToken() {
    if (!this.auth) {
      throw new Error(`Cannot do session refresh without token`);
    }
    return await this.login();
  }

  private scheduleSessionRefresh() {
    if (!this.claims) {
      throw new Error(`Cannot schedule session refresh without token`);
    }
    let { exp } = this.claims;
    if (this.sessionExpirationTimeout) {
      clearTimeout(this.sessionExpirationTimeout);
    }
    let expirationMs = exp * 1000; // token expiration is unix time (seconds)
    let refreshMs = Math.max(
      expirationMs - Date.now() - tokenRefreshPeriodSec * 1000,
      0,
    );
    this.sessionExpirationTimeout = setTimeout(() => {
      this.sessionExpirationTimeout = undefined;
      if (isDestroyed(this) || isDestroying(this)) {
        return;
      }
      this.login();
    }, refreshMs) as unknown as number; // because type is defaultint to NodeJS Timeout type
  }

  private cleanup() {
    // when a resource is destroyed we need to check to see if it is a resource
    // whose timer is managing the session refresh and if so clean up the timer.
    // As well as we need to be careful to cleanup module
    // scope pointers to the destroyed resource.
    // let resources = sessionResources.get(realmURL);
    // resources?.delete(this);
    if (this.sessionExpirationTimeout) {
      clearTimeout(this.sessionExpirationTimeout);
      this.sessionExpirationTimeout = undefined;
    }
  }
}

class RealmNotReadyError extends Error {
  code = 'RealmNotReady';
}
export default class RealmService extends Service {
  @service declare loaderService: LoaderService;

  private realms: Map<string, RealmResource> = restoreSessions(getOwner(this)!);

  async ensureRealmReady(url: string): Promise<void> {
    let token = waiter.beginAsync();
    try {
      let realmResource = this.knownRealm(url);
      if (!realmResource) {
        await this.fetchRealm(url); // this should have the side effect of creating and noting the realm resource
      }
      realmResource = this.knownRealm(url);
      if (!realmResource) {
        throw new RealmNotReadyError(
          `Failed to fetch realm at ${url} and create realm resource`,
        );
      }
      this.requireRealmMeta(url); // this will throw if the realm resource is not fully loaded
    } finally {
      waiter.endAsync(token);
    }
  }

  info = (url: string): RealmInfo => {
    let info = this.requireRealmMeta(url).meta.info;
    if (!info) {
      throw new RealmNotReadyError(
        `Haven't fetched from realm at ${url} yet, so realm info is not available`,
      );
    }
    return info;
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

  private async fetchRealm(url: string): Promise<void> {
    // middleware will ahndle instantiation of a RealmResource
    await this.loaderService.loader.fetch(url, {
      method: 'HEAD',
    });
    return;
  }

  async refreshToken(url: string): Promise<void> {
    await this.requireRealmMeta(url).refreshToken();
  }
}

// TODO: prefer not export these but a test needs it. Can we do better?
export const tokenRefreshPeriodSec = 5 * 60; // 5 minutes
export const sessionLocalStorageKey = 'boxel-session';

export function claimsFromRawToken(rawToken: string): JWTPayload {
  let [_header, payload] = rawToken.split('.');
  return JSON.parse(atob(payload)) as JWTPayload;
}

function restoreSessions(owner: Owner): Map<string, RealmResource> {
  let sessions: Map<string, RealmResource> = new Map();
  let tokens = SessionStorage.getAll();
  if (tokens) {
    for (let [realmURL, token] of Object.entries(tokens)) {
      let claims = claimsFromRawToken(token);
      let expiration = claims.exp;
      if (expiration - tokenRefreshPeriodSec > Date.now() / 1000) {
        let resource = new RealmResource(realmURL, { claims, token });
        setOwner(resource, owner);
        sessions.set(realmURL, resource);
        registerDestructor(resource, () => {
          sessions.delete(realmURL);
        });
      }
    }
  }
  return sessions;
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
  persist(realmURL: string, token: string) {
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
  remove(realmURL: string) {
    let sessionStr = window.localStorage.getItem(sessionLocalStorageKey);
    if (!sessionStr) {
      return;
    }
    let session = JSON.parse(sessionStr);
    delete session[realmURL];
    window.localStorage.setItem(
      sessionLocalStorageKey,
      JSON.stringify(session),
    );
  },
};
