import Service, { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import LoaderService from './loader-service';

export default class MessageService extends Service {
  @tracked subscriptions: Map<string, EventSource> = new Map();
  @service declare loaderService: LoaderService;

  register() {
    (globalThis as any)._CARDSTACK_REALM_SUBSCRIBE = this;
  }

  subscribe(realmURL: string, cb: (ev: MessageEvent) => void): () => void {
    let mappedRealmURL =
      this.loaderService.virtualNetwork.resolveURLMapping(
        realmURL,
        'virtual-to-real',
      ) || realmURL;

    if (!mappedRealmURL) {
      throw new Error(`No mapping found for ${realmURL} in virtual network`);
    }
    let maybeEventSource = this.subscriptions.get(mappedRealmURL);

    if (!maybeEventSource) {
      maybeEventSource = new EventSource(mappedRealmURL);
      maybeEventSource.onerror = () => eventSource.close();
      this.subscriptions.set(mappedRealmURL, maybeEventSource);
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
