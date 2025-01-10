import Service, { service } from '@ember/service';

import { isTesting } from '@embroider/macros';

import { tracked } from '@glimmer/tracking';

import window from 'ember-window-mock';

import qs from 'qs';

import type { RealmURLWrappedServerEvent } from '@cardstack/runtime-common/realm';

import { SessionLocalStorageKey } from '../utils/local-storage-keys';

import type NetworkService from './network';

export default class MessageService extends Service {
  @tracked subscriptions: Map<string, EventSource> = new Map();
  @tracked listenerCallbacks: Map<string, ((ev: ServerEvents) => void)[]> =
    new Map();
  @service private declare network: NetworkService;

  register() {
    (globalThis as any)._CARDSTACK_REALM_SUBSCRIBE = this;
  }

  subscribe(realmURL: string, cb: (ev: MessageEvent) => void): () => void {
    if (isTesting()) {
      // we don't have a way of dealing with internal testing realm URLs when
      // creating an EventSource. The EventSource API is a native browser API
      // that will try to issue a network request for our testing realm URLs
      // otherwise.
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
      maybeEventSource.onerror = () => eventSource.close();
      this.subscriptions.set(realmURL, maybeEventSource);
    }

    let eventSource = maybeEventSource;
    // TODO might want to consider making separate subscription methods so that
    // you can subscribe to a specific type of events instead of all of the
    // events...

    if (!this.listenerCallbacks.has(realmURL)) {
      this.listenerCallbacks.set(realmURL, []);
    }
    this.listenerCallbacks.get(realmURL)?.push(cb);

    eventSource.addEventListener('update', cb);
    eventSource.addEventListener('index', cb);
    return () => {
      eventSource.removeEventListener('update', cb);
      eventSource.removeEventListener('index', cb);
    };
  }

  relayMatrixSSE(realmWrappedEvent: RealmURLWrappedServerEvent) {
    console.log('relaying matrix sse event', realmWrappedEvent);
    this.listenerCallbacks.get(realmWrappedEvent.realmURL)?.forEach((cb) => {
      console.log('callback', cb);
      let eventWithStringData = {
        type: realmWrappedEvent.event.type,
        data: JSON.stringify(realmWrappedEvent.event.data),
      };
      cb(eventWithStringData);
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
