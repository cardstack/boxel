import Service, { service } from '@ember/service';

import { isTesting } from '@embroider/macros';

import { tracked } from '@glimmer/tracking';

import window from 'ember-window-mock';

import qs from 'qs';

import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';

import { SessionLocalStorageKey } from '../utils/local-storage-keys';

import type NetworkService from './network';

export default class MessageService extends Service {
  @tracked subscriptions: Map<string, EventSource> = new Map();
  @tracked listenerCallbacks: Map<string, ((ev: RealmEventContent) => void)[]> =
    new Map();
  @service declare private network: NetworkService;

  register() {
    (globalThis as any)._CARDSTACK_REALM_SUBSCRIBE = this;
  }

  subscribe(realmURL: string, cb: (ev: RealmEventContent) => void): () => void {
    if (!this.listenerCallbacks.has(realmURL)) {
      this.listenerCallbacks.set(realmURL, []);
    }

    // TODO might want to consider making separate subscription methods so that
    // you can subscribe to a specific type of events instead of all of the
    // events...
    this.listenerCallbacks.get(realmURL)?.push(cb);

    if (isTesting()) {
      return () => {};
    }

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

      if (maybeEventSource) {
        maybeEventSource.onerror = () => maybeEventSource?.close();
        maybeEventSource.onmessage = (ev) => {
          throw new Error('received unexpected server-sent event: ' + ev);
        };

        this.subscriptions.set(realmURL, maybeEventSource);
      }
    }

    return () => {};
  }

  relayMatrixSSE(realmURL: string, event: RealmEventContent) {
    this.listenerCallbacks.get(realmURL)?.forEach((cb) => {
      cb(event);
    });
  }
}

function getPersistedTokenForRealm(realmURL: string) {
  if (isTesting()) {
    return 'TEST_TOKEN';
  }

  let sessionStr = window.localStorage.getItem(SessionLocalStorageKey) ?? '{}';
  let session = JSON.parse(sessionStr);
  return session[realmURL] as string | undefined;
}
