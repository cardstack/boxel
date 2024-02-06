import Service, { service } from '@ember/service';

import { TrackedMap } from 'tracked-built-ins';

import { type TokenClaims } from '@cardstack/runtime-common';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import type LoaderService from './loader-service';

type RealmJWT = TokenClaims & { iat: number; exp: number };

const LOCAL_STORAGE_KEY = 'boxel-session';

export default class SessionsService extends Service {
  @service declare matrixService: MatrixService;
  @service declare loaderService: LoaderService;
  @service declare operatorModeStateService: OperatorModeStateService;

  realmURLToRawJWT = new TrackedMap<string, string>();

  constructor(properties: object) {
    super(properties);
    this.extractSessionsFromStorage();
  }

  get canRead() {
    return this.currentJWT?.permissions?.includes('read');
  }

  get canWrite() {
    return this.currentJWT?.permissions?.includes('write');
  }

  get currentJWT() {
    let rawJWT = this.realmURLToRawJWT.get(
      this.operatorModeStateService.realmURL.href,
    );

    if (!rawJWT) {
      return;
    }

    return this.toJWT(rawJWT);
  }

  toJWT(rawJWT: string) {
    let [_header, payload] = rawJWT.split('.');
    let claims = JSON.parse(atob(payload)) as RealmJWT;

    return claims;
  }

  setSession(realmURL: URL, rawToken: string) {
    this.realmURLToRawJWT.set(realmURL.href, rawToken);
    this.persistSessions();
  }

  clearSession(realmURL: URL) {
    this.realmURLToRawJWT.delete(realmURL.href);
    this.persistSessions();
  }

  clearSessions() {
    this.realmURLToRawJWT.clear();
    this.persistSessions();
  }

  private persistSessions() {
    window.localStorage.setItem(
      LOCAL_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(this.realmURLToRawJWT.entries())),
    );
  }

  private extractSessionsFromStorage() {
    let sessionsString = window.localStorage.getItem(LOCAL_STORAGE_KEY);

    if (sessionsString) {
      try {
        this.realmURLToRawJWT = new TrackedMap(
          Object.entries(JSON.parse(sessionsString)),
        );
      } catch (e) {
        console.log('Error restoring sessions', e);
      }
    }
  }

  async getRealmToken(
    realmURL: URL,
    skipCache?: boolean,
  ): Promise<string | undefined> {
    let tokenRefreshPeriod = 5 * 60; // 5 minutes
    let rawJWT = this.realmURLToRawJWT.get(realmURL.href);

    if (rawJWT && !skipCache) {
      let claims = this.toJWT(rawJWT);
      let expiration = claims.exp;
      if (expiration - tokenRefreshPeriod > Date.now() / 1000) {
        return rawJWT;
      }
    }

    rawJWT = await this.createRealmSession(realmURL);
    if (rawJWT) {
      this.setSession(realmURL, rawJWT);
    } else {
      this.clearSession(realmURL);
    }
    return rawJWT;
  }

  private async createRealmSession(realmURL: URL) {
    await this.matrixService.ready;
    if (!this.matrixService.isLoggedIn) {
      return;
    }

    let initialResponse = await this.loaderService.loader.fetch(
      `${realmURL.href}_session`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
        },
        body: JSON.stringify({
          user: this.matrixService.userId,
        }),
      },
    );
    let initialJSON = (await initialResponse.json()) as {
      room: string;
      challenge: string;
    };
    if (initialResponse.status !== 401) {
      throw new Error(
        `unexpected response from POST ${realmURL.href}_session: ${
          initialResponse.status
        } - ${JSON.stringify(initialJSON)}`,
      );
    }
    let { room, challenge } = initialJSON;
    if (!this.matrixService.rooms.has(room)) {
      await this.matrixService.client.joinRoom(room);
    }
    await this.matrixService.sendMessage(room, `auth-response: ${challenge}`);
    let challengeResponse = await this.loaderService.loader.fetch(
      `${realmURL.href}_session`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
        },
        body: JSON.stringify({
          user: this.matrixService.userId,
          challenge,
        }),
      },
    );
    if (!challengeResponse.ok) {
      throw new Error(
        `Could not authenticate with realm ${realmURL.href} - ${
          challengeResponse.status
        }: ${JSON.stringify(await challengeResponse.json())}`,
      );
    }
    return challengeResponse.headers.get('Authorization') ?? undefined;
  }
}
