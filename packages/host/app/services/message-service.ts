import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';

export default class MessageService extends Service {
  @tracked subscriptionsMap: Map<
    string, // URL path
    { eventSource: EventSource; callback: (ev: MessageEvent) => void }[]
  > = new Map();

  subscribe(path: string, cb: (ev: MessageEvent) => void) {
    let info = this.subscriptionsMap.get(path) ?? [];

    if (
      info.length === 0 ||
      info.filter((s) => s.callback != cb).length === 0
    ) {
      info = [...info, { eventSource: new EventSource(path), callback: cb }];
      for (let { eventSource, callback } of info) {
        this.start(eventSource);
        eventSource.addEventListener('update', (ev: MessageEvent) =>
          callback(ev)
        );
      }

      this.subscriptionsMap.set(path, info);
      console.log(`Created new event source for ${path}`);
    }
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

    eventSource.onmessage = (e: MessageEvent) => {
      console.log('Event: message, data: ' + e.data);
    };
  }

  // closeEventSource(eventSource: EventSource) {
  //   eventSource.close();
  //   let info = this.subscriptionsMap.get(eventSource.url);
  //   if (!info) {
  //     return;
  //   }
  //   info = info.filter(
  //     (item) => item.eventSource.readyState === EventSource.OPEN
  //   );
  //   if (info.length === 0) {
  //     this.subscriptionsMap.delete(eventSource.url);
  //     console.log(`removing ${eventSource.url}`);
  //   } else {
  //     console.log(`new count for ${eventSource.url}: ${info.length}`);
  //     this.subscriptionsMap.set(eventSource.url, info);
  //   }
  // }

  unsubscribe(path: string) {
    let info = this.subscriptionsMap.get(path);
    if (info) {
      info.map((item) => item.eventSource.close());
    }
    this.subscriptionsMap.delete(path);
    console.log(`Unsubscribed realm: ${path}`);
  }
}
