import Service, { service } from '@ember/service';

import { isTesting } from '@embroider/macros';

import { tracked } from '@glimmer/tracking';

import window from 'ember-window-mock';

import qs from 'qs';

import { sessionLocalStorageKey } from './realm';

import type MatrixService from './matrix-service';
import type NetworkService from './network';
import type ResetService from './reset';

export default class MessageService extends Service {
  @tracked subscriptions: Map<string, EventSource> = new Map();
  @service private declare network: NetworkService;
  @service private declare reset: ResetService;
  @service private declare matrixService: MatrixService;

  register() {
    (globalThis as any)._CARDSTACK_REALM_SUBSCRIBE = this;
  }

  subscribe(realmURL: string, cb: (ev: MessageEvent) => void): () => void {
    let maybeEventSource = this.subscriptions.get(realmURL);

    if (!maybeEventSource) {
      let token = getPersistedTokenForRealm(realmURL);
      if (!token) {
        throw new Error(`Could not find JWT for realm ${realmURL}`);
      }
      let urlWithAuth = `${realmURL}_message?${qs.stringify({
        authHeader: 'Bearer ' + token,
      })}`;
      maybeEventSource = this.network.createEventSource(urlWithAuth);
      maybeEventSource.onerror = () => eventSource.close();
      this.subscriptions.set(realmURL, maybeEventSource);
    }
    let eventSource = maybeEventSource;

    // TODO might want to consider making separate subscription methods so that
    // you can subscribe to a specific type of events instead of all of the
    // events...
    eventSource.addEventListener('update', cb);
    eventSource.addEventListener('index', cb);

    return () => {
      eventSource.removeEventListener('update', cb);
      eventSource.removeEventListener('index', cb);
    };
  }
}

function getPersistedTokenForRealm(realmURL: string) {
  if (isTesting()) {
    return 'TEST_TOKEN';
  }

  let sessionStr = window.localStorage.getItem(sessionLocalStorageKey) ?? '{}';
  let session = JSON.parse(sessionStr);
  return session[realmURL] as string | undefined;
}
