import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-resources';
import window from 'ember-window-mock';

import { type JWTPayload } from '@cardstack/runtime-common';

import type MatrixService from '@cardstack/host/services/matrix-service';

interface Args {
  named: {
    realmURL: URL;
  };
}

const LOCAL_STORAGE_KEY = 'boxel-session';
const tokenRefreshPeriod = 5 * 60; // 5 minutes

export class RealmSessionResource extends Resource<Args> {
  @tracked token: JWTPayload | undefined;
  private _rawToken: string | undefined;
  @tracked loaded: Promise<void> | undefined;
  @service private declare matrixService: MatrixService;

  modify(_positional: never[], named: Args['named']) {
    this.token = undefined;
    this._rawToken = undefined;

    let tokens = extractSessionsFromStorage();
    let rawToken: string | undefined;
    if (tokens) {
      rawToken = tokens[named.realmURL.href];
      if (rawToken) {
        let claims = claimsFromRawToken(rawToken);
        let expiration = claims.exp;
        if (expiration - tokenRefreshPeriod > Date.now() / 1000) {
          this.token = claims;
          this._rawToken = rawToken;
          this.loaded = Promise.resolve();
        }
      }
    }

    if (!this.token) {
      this.loaded = this.getToken.perform(named.realmURL);
    }
  }

  get canRead() {
    return this.token?.permissions?.includes('read');
  }

  get canWrite() {
    return this.token?.permissions?.includes('write');
  }

  get realmToken() {
    return this._rawToken;
  }

  private getToken = restartableTask(async (realmURL: URL) => {
    let rawToken = await this.matrixService.createRealmSession(realmURL);
    if (rawToken) {
      this.token = claimsFromRawToken(rawToken);
      this._rawToken = rawToken;
      setRealmSession(realmURL, rawToken);
    } else {
      this.token = undefined;
      this._rawToken = undefined;
      clearRealmSession(realmURL);
    }
  });
}

export function getRealmSession(parent: object, realmURL: () => URL) {
  return RealmSessionResource.from(parent, () => ({
    realmURL: realmURL(),
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

function extractSessionsFromStorage(): Record<string, string> | undefined {
  let sessionsString = window.localStorage.getItem(LOCAL_STORAGE_KEY);
  if (sessionsString) {
    return JSON.parse(sessionsString);
  }
  return undefined;
}
