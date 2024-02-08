import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-resources';

import { type TokenClaims } from '@cardstack/runtime-common';

import type MatrixService from '@cardstack/host/services/matrix-service';

interface Args {
  named: {
    realmURL: URL;
  };
}

type RealmJWT = TokenClaims & { iat: number; exp: number };

const LOCAL_STORAGE_KEY = 'boxel-session';
const tokenRefreshPeriod = 5 * 60; // 5 minutes

export class RealmResource extends Resource<Args> {
  @tracked token: RealmJWT | undefined;
  @tracked loaded: Promise<void> | undefined;
  @tracked private realmURL: URL | undefined;
  @service private declare matrixService: MatrixService;

  modify(_positional: never[], named: Args['named']) {
    this.token = undefined;
    this.realmURL = named.realmURL;

    let tokens = extractSessionsFromStorage();
    let rawToken: string | undefined;
    if (tokens) {
      rawToken = tokens[this.realmURL.href];
      if (rawToken) {
        let claims = claimsFromRawToken(rawToken);
        let expiration = claims.exp;
        if (expiration - tokenRefreshPeriod > Date.now() / 1000) {
          this.token = claims;
          this.loaded = Promise.resolve();
        }
      }
    }

    if (!this.token) {
      this.loaded = this.getToken.perform(this.realmURL);
    }
  }

  get url() {
    return this.realmURL;
  }

  get canRead() {
    return this.token?.permissions?.includes('read');
  }

  get canWrite() {
    return this.token?.permissions?.includes('write');
  }

  private getToken = restartableTask(async (realmURL: URL) => {
    if (!this.url) {
      throw new Error(`bug: no realm URL--should never get here`);
    }
    let rawToken = await this.matrixService.createRealmSession(realmURL);
    if (rawToken) {
      this.token = claimsFromRawToken(rawToken);
      setRealmSession(this.url, rawToken);
    } else {
      this.token = undefined;
      clearRealmSession(this.url);
    }
  });
}

export function getRealm(parent: object, realmURL: () => URL) {
  return RealmResource.from(parent, () => ({
    realmURL: realmURL(),
  })) as RealmResource;
}

export function clearAllRealmSessions() {
  window.localStorage.removeItem(LOCAL_STORAGE_KEY);
}

function setRealmSession(realmURL: URL, rawToken: string) {
  let sessionStr = localStorage.getItem(LOCAL_STORAGE_KEY) ?? '{}';
  let session = JSON.parse(sessionStr);
  session[realmURL.href] = rawToken;
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(session));
}

function clearRealmSession(realmURL: URL) {
  let sessionStr = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!sessionStr) {
    return;
  }
  let session = JSON.parse(sessionStr);
  delete session[realmURL.href];
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(session));
}

function claimsFromRawToken(rawToken: string): RealmJWT {
  let [_header, payload] = rawToken.split('.');
  return JSON.parse(atob(payload)) as RealmJWT;
}

function extractSessionsFromStorage(): Record<string, string> | undefined {
  let sessionsString = window.localStorage.getItem(LOCAL_STORAGE_KEY);
  if (sessionsString) {
    return JSON.parse(sessionsString);
  }
  return undefined;
}
