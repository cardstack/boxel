import Service, { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import type NetworkService from './network';
import type SessionService from './session';
import type { RealmEventContent } from '@cardstack/base/matrix-event';

export default class MessageService extends Service {
  @tracked listenerCallbacks: Map<string, ((ev: RealmEventContent) => void)[]> =
    new Map();
  @service declare private network: NetworkService;
  @service declare private session: SessionService;

  constructor(...args: ConstructorParameters<typeof Service>) {
    super(...args);
    this.session.register(this);
  }

  register() {
    (globalThis as any)._CARDSTACK_REALM_SUBSCRIBE = this;
  }

  resetState() {
    // Unlike RealmServerService.eventSubscribers (app-scoped wiring registered
    // once in a service constructor — must survive logout), these callbacks are
    // held by components and resources that subscribe on mount and unsubscribe
    // in their destructor. The <Auth/> swap on logout unmounts them, so this
    // wipe is normally redundant; it stays as a safety net for the test
    // environment, where subscribers aren't always torn down between sessions.
    // Re-login re-subscribes fresh (RealmResource.subscribe(), etc.), so a clear
    // here can't strand a live session's wiring.
    this.listenerCallbacks = new Map();
    if ((globalThis as any)._CARDSTACK_REALM_SUBSCRIBE === this) {
      delete (globalThis as any)._CARDSTACK_REALM_SUBSCRIBE;
    }
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
      let callbackIndex = callbacksForRealm.indexOf(cb);
      if (callbackIndex === -1) {
        return;
      }
      callbacksForRealm.splice(callbackIndex, 1);
      if (callbacksForRealm.length === 0) {
        this.listenerCallbacks.delete(realmURL);
      }
    }
  }

  relayRealmEvent(event: RealmEventContent) {
    const realmURL = event.realmURL;
    if (!realmURL) {
      return;
    }
    let callbacks = this.listenerCallbacks.get(realmURL);
    callbacks?.forEach((cb) => {
      cb(event);
    });
  }
}

declare module '@ember/service' {
  interface Registry {
    'message-service': MessageService;
  }
}
