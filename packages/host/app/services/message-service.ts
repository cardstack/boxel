import Service, { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';

import type NetworkService from './network';

export default class MessageService extends Service {
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
    let wrapper = (ev: RealmEventContent) => {
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
    }
  }

  relayRealmEvent(event: RealmEventContent) {
    const realmURL = event.realmURL;
    if (!realmURL) {
      return;
    }
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
