import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { service } from '@ember/service';
import type LoaderService from './loader-service';

export default class MessageService extends Service {
  @tracked subscriptions: Map<string, EventSource> = new Map();
  @service declare loaderService: LoaderService;

  register() {
    (globalThis as any)._CARDSTACK_REALM_SUBSCRIBE = this;
  }

  subscribe(realmURL: string, cb: (ev: MessageEvent) => void): () => void {
    let resolvedRealmURL = this.loaderService.loader.resolve(realmURL);
    let maybeEventSource = this.subscriptions.get(resolvedRealmURL.href);

    if (!maybeEventSource) {
      maybeEventSource = new EventSource(resolvedRealmURL);
      maybeEventSource.onerror = () => eventSource.close();
      this.subscriptions.set(resolvedRealmURL.href, maybeEventSource);
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
