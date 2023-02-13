import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';

export default class MessageService extends Service {
  @tracked subscriptionsMap: Map<string, EventSource> = new Map();

  subscribe(url: string, cb: (ev: MessageEvent) => void) {
    if (!this.subscriptionsMap.has(url)) {
      this.subscriptionsMap.set(url, new EventSource(`${url}_message`));
      console.log(`Created new event source for ${url}`);
    }
    let eventSource = this.subscriptionsMap.get(url);
    if (!eventSource) {
      throw new Error('No event source found. This should not happen.');
    }
    this.start(eventSource, cb);
  }

  unsubscribe(url: string) {
    let eventSource = this.subscriptionsMap.get(url);
    if (!eventSource) {
      throw new Error('No event source found for unsubscribe.');
    }
    this.stop(eventSource);
  }

  start(eventSource: EventSource, cb: (ev: MessageEvent) => void) {
    eventSource.onerror = (_ev: Event) => {
      if (eventSource.readyState == EventSource.CONNECTING) {
        console.log(`Reconnecting to ${eventSource.url}...`);
      } else if (eventSource.readyState == EventSource.CLOSED) {
        console.log(`Connection closed for ${eventSource.url}`);
      } else {
        console.log(`An error has occured for ${eventSource.url}`);
      }
    };

    eventSource.onmessage = (e: MessageEvent) => {
      console.log('Event: message, data: ' + e.data);
      cb(e);
    };
  }

  stop(eventSource: EventSource) {
    eventSource.close();
    if (eventSource.readyState !== EventSource.CLOSED) {
      throw new Error('EventSource did not close');
    }
    this.subscriptionsMap.delete(eventSource.url);
    console.log(`Unsubscribed ${eventSource.url}`);
  }
}
