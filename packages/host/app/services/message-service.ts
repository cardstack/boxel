import Service, { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';

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

    return () => {};
  }

  relayDeprecatedSSE(realmURL: string, event: MessageEvent) {
    let realmEvent = JSON.parse(event.data);
    this.listenerCallbacks.get(realmURL)?.forEach((cb) => {
      cb(realmEvent);
    });
  }

  relayRealmEvent(realmURL: string, event: RealmEventContent) {
    this.listenerCallbacks.get(realmURL)?.forEach((cb) => {
      cb(event);
    });
  }
}
