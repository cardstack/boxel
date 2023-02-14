import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';

export default class MessageService extends Service {
  @tracked subscriptionsMap: Map<string, EventSource> = new Map();

  mappedURL(url: string) {
    return `${url}_message`;
  }

  subscribe(url: string, cb: (ev: MessageEvent) => void) {
    if (!this.subscriptionsMap.has(this.mappedURL(url))) {
      let eventSource = new EventSource(this.mappedURL(url));
      this.subscriptionsMap.set(this.mappedURL(url), eventSource);
      console.log(`Created new event source for ${this.mappedURL(url)}`);
      this.start(eventSource, cb);
    }
  }

  unsubscribe(url: string) {
    let eventSource = this.subscriptionsMap.get(this.mappedURL(url));
    if (!eventSource) {
      throw new Error(
        `No event source found for unsubscribe ${this.mappedURL(url)}`
      );
    }
    this.stop(eventSource);
  }

  start(eventSource: EventSource, cb: (ev: MessageEvent) => void) {
    eventSource.onerror = (_ev: Event) => {
      if (eventSource.readyState == EventSource.CONNECTING) {
        console.log(`Reconnecting to ${eventSource.url}...`);
      } else if (eventSource.readyState == EventSource.CLOSED) {
        console.log(`Connection closed for ${eventSource.url}`);
        this.stop(eventSource);
      } else {
        console.log(`An error has occured for ${eventSource.url}`);
      }
    };

    eventSource.onmessage = (e: MessageEvent) => {
      console.log('Event: message, data: ' + e.data);
    };

    eventSource.addEventListener('update', (e: MessageEvent) => {
      cb(e);
    });
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
