import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask, timeout } from 'ember-concurrency';
import { Resource } from 'ember-resources';
import window from 'ember-window-mock';

import { type JWTPayload } from '@cardstack/runtime-common';

import type CardService from '@cardstack/host/services/card-service';
import type MatrixService from '@cardstack/host/services/matrix-service';

import type { CardDef } from 'https://cardstack.com/base/card-api';

interface Args {
  named: {
    realmURL?: URL;
    card?: CardDef;
  };
}

export const sessionLocalStorageKey = 'boxel-session';
export const tokenRefreshPeriodSec = 5 * 60; // 5 minutes

export class RealmSessionResource extends Resource<Args> {
  @tracked private token: JWTPayload | undefined;
  private rawToken: string | undefined;
  @tracked loaded: Promise<void> | undefined;
  @service private declare matrixService: MatrixService;
  @service private declare cardService: CardService;

  modify(_positional: never[], named: Args['named']) {
    let { realmURL, card } = named;
    if (!realmURL && !card) {
      throw new Error(
        `must provide either a realm URL or a card in order to get RealmSessionResource`,
      );
    }
    this.token = undefined;
    if (realmURL) {
      let rawToken = processTokenFromStorage(realmURL);
      if (rawToken) {
        this.setToken(rawToken);
        this.loaded = Promise.resolve();
      }
      if (!this.token) {
        this.loaded = this.getToken.perform(realmURL);
      }
    } else if (card) {
      this.loaded = this.getTokenForRealmOfCard.perform(card);
    }
  }

  get canRead() {
    return this.token?.permissions?.includes('read');
  }

  get canWrite() {
    return this.token?.permissions?.includes('write');
  }

  get rawRealmToken() {
    return this.rawToken;
  }

  private scheduleSessionRefresh = restartableTask(async () => {
    if (!this.token) {
      throw new Error(`Cannot schedule session refresh without token`);
    }
    let { realm, exp } = this.token;
    let expirationMs = exp * 1000; // token expiration is unix time (seconds)
    let refreshMs = Math.max(
      expirationMs - Date.now() - tokenRefreshPeriodSec * 1000,
      0,
    );
    // use EC timeout so we can gracefully handle clearing timeouts when this
    // resource is destroyed
    await timeout(refreshMs);
    // make sure the token still exists in local storage, otherwise we have been
    // logged out while we were waiting for the session to expire
    if (processTokenFromStorage(new URL(realm))) {
      await this.getToken.perform(new URL(realm));
    }
  });

  private getTokenForRealmOfCard = restartableTask(async (card: CardDef) => {
    let realmURL = await this.cardService.getRealmURL(card);
    let rawToken = processTokenFromStorage(realmURL);
    if (rawToken) {
      this.setToken(rawToken);
    } else {
      await this.getToken.perform(realmURL);
    }
  });

  private getToken = restartableTask(async (realmURL: URL) => {
    await this.matrixService.ready;
    let rawToken = await this.matrixService.createRealmSession(realmURL);

    if (rawToken) {
      this.setToken(rawToken);
    } else {
      this.clearToken(realmURL);
    }
  });

  private setToken(rawToken: string) {
    this.rawToken = rawToken;
    this.token = claimsFromRawToken(rawToken);
    persistRealmSession(rawToken);
    this.scheduleSessionRefresh.perform();
  }

  private clearToken(realmURL: URL) {
    this.token = undefined;
    this.rawToken = undefined;
    this.scheduleSessionRefresh.cancelAll();
    clearRealmSession(realmURL);
  }
}

export function getRealmSession(
  parent: object,
  {
    realmURL,
    card,
  }: {
    // a realm resource can either be loaded by RealmURL directly, or by the
    // realm URL associated with the provided card
    realmURL?: () => URL;
    card?: () => CardDef;
  },
) {
  return RealmSessionResource.from(parent, () => ({
    realmURL: realmURL?.(),
    card: card?.(),
  })) as RealmSessionResource;
}

export function clearAllRealmSessions() {
  window.localStorage.removeItem(sessionLocalStorageKey);
}

function persistRealmSession(rawToken: string) {
  let sessionStr = window.localStorage.getItem(sessionLocalStorageKey) ?? '{}';
  let session = JSON.parse(sessionStr);
  let { realm } = claimsFromRawToken(rawToken);
  if (session[realm] !== rawToken) {
    session[realm] = rawToken;
    window.localStorage.setItem(
      sessionLocalStorageKey,
      JSON.stringify(session),
    );
  }
}

function clearRealmSession(realmURL: URL) {
  let sessionStr = window.localStorage.getItem(sessionLocalStorageKey);
  if (!sessionStr) {
    return;
  }
  let session = JSON.parse(sessionStr);
  delete session[realmURL.href];
  window.localStorage.setItem(sessionLocalStorageKey, JSON.stringify(session));
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
  let sessionsString = window.localStorage.getItem(sessionLocalStorageKey);
  if (sessionsString) {
    return JSON.parse(sessionsString);
  }
  return undefined;
}
