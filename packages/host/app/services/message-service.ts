import type Owner from '@ember/owner';

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
  @tracked subscriptions: Map<
    string,
    { eventSource: EventSource; unsubscribes: (() => void)[] }
  > = new Map();
  @service private declare network: NetworkService;
  @service private declare reset: ResetService;
  @service private declare matrixService: MatrixService;

  constructor(owner: Owner) {
    super(owner);
    this.reset.register(this);
  }

  register() {
    (globalThis as any)._CARDSTACK_REALM_SUBSCRIBE = this;
  }

  subscribe(realmURL: string, cb: (ev: MessageEvent) => void): () => void {
    let { eventSource: maybeEventSource, unsubscribes = [] } =
      this.subscriptions.get(realmURL) ?? {};

    let eventSource: EventSource;
    if (!maybeEventSource) {
      let token = getPersistedTokenForRealm(realmURL);
      if (!token) {
        throw new Error(`Could not find JWT for realm ${realmURL}`);
      }
      let urlWithAuth = `${realmURL}_message?${qs.stringify({
        authHeader: 'Bearer ' + token,
      })}`;
      eventSource = this.network.createEventSource(urlWithAuth);
      eventSource.onerror = () => eventSource!.close();
      this.subscriptions.set(realmURL, { eventSource, unsubscribes });
    } else {
      eventSource = maybeEventSource;
    }

    // TODO might want to consider making separate subscription methods so that
    // you can subscribe to a specific type of events instead of all of the
    // events...
    eventSource.addEventListener('update', cb);
    eventSource.addEventListener('index', cb);

    let unsubscribe = () => {
      eventSource.removeEventListener('update', cb);
      eventSource.removeEventListener('index', cb);
    };
    unsubscribes.push(unsubscribe);
    return unsubscribe;
  }

  resetState() {
    for (let { unsubscribes } of this.subscriptions.values()) {
      for (let unsubscribe of unsubscribes) {
        unsubscribe();
      }
    }
    this.subscriptions = new Map();
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
