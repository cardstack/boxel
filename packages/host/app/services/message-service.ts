import Service, { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import { canonicalRealmIdentifier } from '../lib/realm-utils';

import type NetworkService from './network';
import type SessionService from './session';
import type { RealmEventContent } from '@cardstack/base/matrix-event';

export default class MessageService extends Service {
  @tracked listenerCallbacks: Map<string, ((ev: RealmEventContent) => void)[]> =
    new Map();
  @service declare private network: NetworkService;
  @service declare private session: SessionService;
  // App-scoped wiring, like RealmServerService.eventSubscribers: a service
  // registers once in its constructor, so logout leaves these in place.
  private firstSubscriptionListeners = new Set<(realm: string) => void>();

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

  // Subscriptions and deliveries are keyed by the realm in the form card ids
  // carry, so a subscriber may name a realm by any of its spellings: an event
  // carries the URL the realm was started under (the alias for base), while a
  // subscriber may hold its prefix or the URL it is served from.
  private keyFor(realmURL: string): string {
    return canonicalRealmIdentifier(this.network.virtualNetwork, realmURL);
  }

  subscribe(realmURL: string, cb: (ev: RealmEventContent) => void): () => void {
    let key = this.keyFor(realmURL);
    if (!this.listenerCallbacks.has(key)) {
      this.listenerCallbacks.set(key, []);
      for (let listener of this.firstSubscriptionListeners) {
        listener(key);
      }
    }

    // TODO might want to consider making separate subscription methods so that
    // you can subscribe to a specific type of events instead of all of the
    // events...
    let wrapper = (ev: RealmEventContent) => {
      cb(ev);
    };
    this.listenerCallbacks.get(key)?.push(wrapper);

    return () => {
      this.removeSubscriptionCallback(key, wrapper);
    };
  }

  // The realms that have at least one subscriber.
  subscribedRealms(): string[] {
    return [...this.listenerCallbacks.keys()];
  }

  // Calls `listener` with each realm as it gains its first subscriber, starting
  // with the realms subscribed to already. A world-readable realm's events
  // arrive in a room of their own, which RealmServerService joins this way.
  onFirstSubscription(listener: (realm: string) => void): () => void {
    this.firstSubscriptionListeners.add(listener);
    for (let realm of this.listenerCallbacks.keys()) {
      listener(realm);
    }
    return () => {
      this.firstSubscriptionListeners.delete(listener);
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
    // A callback can unsubscribe while the event is delivered, which removes
    // it from this list; iterating a copy keeps that from skipping the next
    // callback.
    let callbacks = this.listenerCallbacks.get(this.keyFor(realmURL));
    [...(callbacks ?? [])].forEach((cb) => {
      cb(event);
    });
  }
}

declare module '@ember/service' {
  interface Registry {
    'message-service': MessageService;
  }
}
