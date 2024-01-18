import Service, { service } from '@ember/service';

import { TrackedMap } from 'tracked-built-ins';

import { type TokenClaims } from '@cardstack/runtime-common';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

type RealmJWT = TokenClaims & { iat: number; exp: number };

const LOCAL_STORAGE_KEY = 'boxel-sessions';

export default class SessionsService extends Service {
  @service declare operatorModeStateService: OperatorModeStateService;

  realmURLToRawJWT = new TrackedMap<String, String>();

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
}
