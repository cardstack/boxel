import { registerDestructor } from '@ember/destroyable';
import Service, { service } from '@ember/service';

import { task } from 'ember-concurrency';

import window from 'ember-window-mock';

import { type JWTPayload } from '@cardstack/runtime-common';
import { RealmAuthClient } from '@cardstack/runtime-common/realm-auth-client';

import type LoaderService from './loader-service';
import type MatrixService from './matrix-service';
import type { RealmSessionResource } from '../resources/realm-session';

export const LOCAL_STORAGE_KEY = 'boxel-session';
const tokenRefreshPeriodSec = 5 * 60; // 5 minutes

// we use a service for the session as a means to manage the lifetime for the
// session expiration timers. The primary consumer of this service should be the
// RealmSessionResource.
export default class SessionService extends Service {
  @service private declare matrixService: MatrixService;
  @service declare loaderService: LoaderService;
  private realmSessionTasks: Map<string, Promise<string>> = new Map(); // key: realmURL, value: promise for JWT
  private sessionExpirations: Map<string, number> = new Map();

  constructor(properties: object) {
    super(properties);
    registerDestructor(this, () => {
      for (let timeout of this.sessionExpirations.values()) {
        clearTimeout(timeout);
      }
    });
  }

  // The _only_ consumer of this API should be the RealmSessionResource. Please
  // use the RealmSessionResource to obtain a realm session.
  async loadSession(
    realmSessionResource: RealmSessionResource,
  ): Promise<{ rawToken: string; token: JWTPayload } | undefined> {
    let realmURL = await realmSessionResource.realmURL;
    if (!realmURL) {
      throw new Error(
        `could not determine realm URL from RealmSessionResource`,
      );
    }
    let rawToken = processTokenFromStorage(realmURL);
    let token: JWTPayload | undefined;
    if (rawToken) {
      token = claimsFromRawToken(rawToken);
    } else {
      rawToken = await this.createSession(realmURL);
      if (rawToken) {
        token = claimsFromRawToken(rawToken);
        setRealmSession(realmURL, rawToken);
      }
    }

    if (rawToken && token) {
      this.scheduleSessionRefresh(token);
      return { rawToken, token };
    }
    this.clearRealmSession(realmURL);
    return undefined;
  }

  // all consumers are welcome to use this method
  logout() {
    window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    for (let timeout of this.sessionExpirations.values()) {
      clearTimeout(timeout);
    }
  }

  private async createSession(realmURL: URL): Promise<string> {
    await this.matrixService.ready;

    let inflightAuth = this.realmSessionTasks.get(realmURL.href);

    if (inflightAuth) {
      return inflightAuth;
    }

    let realmAuthClient = new RealmAuthClient(
      realmURL,
      this.matrixService.client,
      this.loaderService.loader,
    );

    let jwtPromise = realmAuthClient.getJWT();

    this.realmSessionTasks.set(realmURL.href, jwtPromise);

    jwtPromise.finally(() => {
      this.realmSessionTasks.delete(realmURL.href);
    });

    return jwtPromise;
  }

  private scheduleSessionRefresh(token: JWTPayload) {
    let { realm } = token;
    if (this.sessionExpirations.has(realm)) {
      return;
    }

    let expirationMs = token.exp * 1000; // token expiration is unix time (seconds)
    let refreshMs = Math.max(
      expirationMs - Date.now() - tokenRefreshPeriodSec * 1000,
      0,
    );
    this.sessionExpirations.set(
      realm,
      setTimeout(() => {
        this.createSessionTask.perform(new URL(realm));
      }, refreshMs) as unknown as number,
    ); // don't use NodeJS Timeout type
  }

  private createSessionTask = task(async (realmURL: URL) => {
    await this.createSession(realmURL);
  });

  private clearRealmSession(realmURL: URL) {
    let sessionStr = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!sessionStr) {
      return;
    }
    let session = JSON.parse(sessionStr);
    delete session[realmURL.href];
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(session));
    clearTimeout(this.sessionExpirations.get(realmURL.href));
  }
}

export function claimsFromRawToken(rawToken: string): JWTPayload {
  let [_header, payload] = rawToken.split('.');
  return JSON.parse(atob(payload)) as JWTPayload;
}

function processTokenFromStorage(realmURL: URL) {
  let tokens = extractSessionsFromStorage();
  let rawToken: string | undefined;
  if (tokens) {
    rawToken = tokens[realmURL.href];
    if (rawToken) {
      let claims = claimsFromRawToken(rawToken);
      let expiration = claims.exp;
      if (expiration - tokenRefreshPeriodSec > Date.now() / 1000) {
        return rawToken;
      }
    }
  }
  return undefined;
}

function extractSessionsFromStorage(): Record<string, string> | undefined {
  let sessionsString = window.localStorage.getItem(LOCAL_STORAGE_KEY);
  if (sessionsString) {
    return JSON.parse(sessionsString);
  }
  return undefined;
}

function setRealmSession(realmURL: URL, rawToken: string) {
  let sessionStr = window.localStorage.getItem(LOCAL_STORAGE_KEY) ?? '{}';
  let session = JSON.parse(sessionStr);
  session[realmURL.href] = rawToken;
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(session));
}
