import Service, { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import type { RealmEventEventContent } from 'https://cardstack.com/base/matrix-event';

import type NetworkService from './network';

export default class MessageService extends Service {
  @tracked subscriptions: Map<string, EventSource> = new Map();
  @tracked listenerCallbacks: Map<
    string,
    ((ev: RealmEventEventContent) => void)[]
  > = new Map();
  @service declare private network: NetworkService;

  register() {
    (globalThis as any)._CARDSTACK_REALM_SUBSCRIBE = this;
  }

  subscribe(
    realmURL: string,
    cb: (ev: RealmEventEventContent) => void,
  ): () => void {
    if (!this.listenerCallbacks.has(realmURL)) {
      this.listenerCallbacks.set(realmURL, []);
    }
    this.listenerCallbacks.get(realmURL)?.push(cb);
    return () => {};
  }

  relayMatrixSSE(realmURL: string, event: RealmEventEventContent) {
    console.log('relaying matrix sse event', realmURL, event);
    console.log('listener callbacks', this.listenerCallbacks);
    this.listenerCallbacks.get(realmURL)?.forEach((cb) => {
      cb(event);
    });
  }
}
