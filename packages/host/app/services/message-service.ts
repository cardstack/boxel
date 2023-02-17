import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';

export default class MessageService extends Service {
  @tracked subscriptions: Map<string, EventSource> = new Map();

  subscribe(realmURL: string, cb: (ev: MessageEvent) => void): () => void {
    let maybeEventSource = this.subscriptions.get(realmURL);

    if (!maybeEventSource) {
      maybeEventSource = new EventSource(realmURL);
      this.start(maybeEventSource);
      this.subscriptions.set(realmURL, maybeEventSource);
    }

    let eventSource = maybeEventSource;
    eventSource.addEventListener('update', cb);
    console.log(`Created new event source for ${realmURL}`);
    return () => {
      eventSource.removeEventListener('update', cb);
      console.log(`Unsubscribed realm: ${realmURL}`);
    };
  }

  start(eventSource: EventSource) {
    eventSource.onerror = (_ev: Event) => {
      if (eventSource.readyState == EventSource.CONNECTING) {
        console.log(`Reconnecting to ${eventSource.url}...`);
      } else if (eventSource.readyState == EventSource.CLOSED) {
        console.log(`Connection closed for ${eventSource.url}`);
        eventSource.close();
      } else {
        console.log(`An error has occured for ${eventSource.url}`);
      }
    };

    eventSource.onmessage = (ev: MessageEvent) => {
      console.log('Event: message, data: ' + ev.data);
    };
  }
}
