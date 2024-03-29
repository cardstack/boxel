import Service from '@ember/service';

import { tracked } from '@glimmer/tracking';

export default class MessageService extends Service {
  @tracked subscriptions: Map<string, EventSource> = new Map();

  register() {
    (globalThis as any)._CARDSTACK_REALM_SUBSCRIBE = this;
  }

  subscribe(realmURL: string, cb: (ev: MessageEvent) => void): () => void {
    let maybeEventSource = this.subscriptions.get(realmURL);

    if (!maybeEventSource) {
      maybeEventSource = new EventSource(realmURL);
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
