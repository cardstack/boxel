import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
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

const LOCAL_STORAGE_KEY = 'boxel-session';
const tokenRefreshPeriod = 5 * 60; // 5 minutes

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
        this.token = claimsFromRawToken(rawToken);
        this.rawToken = rawToken;
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

  private getTokenForRealmOfCard = restartableTask(async (card: CardDef) => {
    let realmURL = await this.cardService.getRealmURL(card);
    let rawToken = processTokenFromStorage(realmURL);
    if (rawToken) {
      this.token = claimsFromRawToken(rawToken);
      this.rawToken = rawToken;
    } else {
      await this.getToken.perform(realmURL);
    }
  });

  private getToken = restartableTask(async (realmURL: URL) => {
    await this.matrixService.ready;
    let rawToken = await this.matrixService.createRealmSession(realmURL);

    if (rawToken) {
      this.token = claimsFromRawToken(rawToken);
      this.rawToken = rawToken;
      setRealmSession(realmURL, rawToken);
    } else {
      this.token = undefined;
      this.rawToken = undefined;
      clearRealmSession(realmURL);
    }
  });
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
  window.localStorage.removeItem(LOCAL_STORAGE_KEY);
}

function setRealmSession(realmURL: URL, rawToken: string) {
  let sessionStr = window.localStorage.getItem(LOCAL_STORAGE_KEY) ?? '{}';
  let session = JSON.parse(sessionStr);
  session[realmURL.href] = rawToken;
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(session));
}

function clearRealmSession(realmURL: URL) {
  let sessionStr = window.localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!sessionStr) {
    return;
  }
  let session = JSON.parse(sessionStr);
  delete session[realmURL.href];
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(session));
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
      if (expiration - tokenRefreshPeriod > Date.now() / 1000) {
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
