import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';

export default class MessageService extends Service {
  @tracked subscriptions: Map<string, EventSource> = new Map();

  subscribe(realmURL: string, cb: (ev: MessageEvent) => void): () => void {
    let maybeEventSource = this.subscriptions.get(realmURL);

    if (!maybeEventSource) {
      maybeEventSource = new EventSource(realmURL);
      maybeEventSource.onerror = () => eventSource.close();
      this.subscriptions.set(realmURL, maybeEventSource);
    }

    let eventSource = maybeEventSource;
    eventSource.addEventListener('update', cb);
    return () => {
      eventSource.removeEventListener('update', cb);
    };
  }
}
