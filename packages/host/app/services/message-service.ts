import Service, { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';

import type NetworkService from './network';

export default class MessageService extends Service {
  @tracked listenerCallbacks: Map<string, ((ev: RealmEventContent) => void)[]> =
    new Map();
  @service declare private network: NetworkService;

  constructor() {
    super(...arguments);
    this.register();
    console.info('message-service: registered global realm subscription hook');
  }

  register() {
    (globalThis as any)._CARDSTACK_REALM_SUBSCRIBE = this;
  }

  subscribe(realmURL: string, cb: (ev: RealmEventContent) => void): () => void {
    let cbId = Math.random().toString(36).slice(2, 8);
    console.info(`message-service: subscribe ${realmURL} (cb=${cbId})`);
    if (!this.listenerCallbacks.has(realmURL)) {
      this.listenerCallbacks.set(realmURL, []);
    }

    // TODO might want to consider making separate subscription methods so that
    // you can subscribe to a specific type of events instead of all of the
    // events...
    let wrapper = (ev: RealmEventContent) => {
      console.info(
        `message-service: invoking cb=${cbId} for ${realmURL} with event ${JSON.stringify(ev)}`,
      );
      cb(ev);
    };
    this.listenerCallbacks.get(realmURL)?.push(wrapper);

    return () => {
      this.removeSubscriptionCallback(realmURL, wrapper);
    };
  }

  private removeSubscriptionCallback(
    realmURL: string,
    cb: (ev: RealmEventContent) => void,
  ) {
    let callbacksForRealm = this.listenerCallbacks.get(realmURL);

    if (callbacksForRealm) {
      callbacksForRealm.splice(callbacksForRealm.indexOf(cb), 1);
      console.info(
        `message-service: unsubscribe ${realmURL} (cb=${cb.toString().slice(0, 40)}) remaining=${callbacksForRealm.length}`,
      );
    }
  }

  relayRealmEvent(realmURL: string, event: RealmEventContent) {
    console.info(
      `message-service: relaying realm event to ${this.listenerCallbacks.get(realmURL)?.length ?? 0} listeners for ${realmURL}`,
    );
    this.listenerCallbacks.get(realmURL)?.forEach((cb) => {
      cb(event);
    });
  }
}

declare module '@ember/service' {
  interface Registry {
    'message-service': MessageService;
  }
}
