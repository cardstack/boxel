<<<<<<< HEAD
import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import type CardService from '../services/card-service';

export interface EventMessage {
  url: string;
  event: string;
}

export default class MessageService extends Service {
  @service declare cardService: CardService;
  @tracked eventSource: EventSource | undefined;

  get isClosed() {
    return this.eventSource?.readyState === EventSource.CLOSED;
  }

  subscribe(realmURL: string) {
    this.start(realmURL);
  }

  unsubscribe(realmURL: string) {
    this.stop(realmURL);
  }

  start(realmURL: string) {
    if (!this.eventSource || this.isClosed) {
      this.eventSource = new EventSource(`${realmURL}_message`);
      console.log(`Created new event source for realm ${realmURL}`);
    }

    this.eventSource.onerror = (_ev: Event) => {
      if (this.eventSource?.readyState == EventSource.CONNECTING) {
        console.log(
          `Reconnecting (readyState=${this.eventSource.readyState})...`
        );
      } else if (this.isClosed) {
        console.log(
          `Connection closed (readyState=${this.eventSource?.readyState})`
        );
      } else {
        console.log(`An error has occured`);
      }
    };

    this.eventSource.onmessage = (e: MessageEvent) => {
      console.log('Event: message, data: ' + e.data);
    };
  }

  stop(_realmURL: string) {
    // we will map realmURL to eventSource and close accordingly
    if (this.eventSource) {
      this.eventSource.close();
      if (this.isClosed) {
        console.log('Connection closed');
        this.eventSource = undefined;
      }
    }
  }
}
||||||| 466973da
=======
import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import type CardService from '../services/card-service';
import { RealmPaths } from '@cardstack/runtime-common';

export default class MessageService extends Service {
  @service declare cardService: CardService;
  @tracked eventSource: EventSource | undefined = undefined;

  get isClosed() {
    return this.eventSource?.readyState === EventSource.CLOSED;
  }

  start() {
    if (!this.eventSource || this.isClosed) {
      let realmPath = new RealmPaths(this.cardService.defaultURL);
      this.eventSource = new EventSource(`${realmPath.url}_message`);
      console.log('Created new event source');
    }

    this.eventSource.onerror = (_ev: Event) => {
      if (this.eventSource?.readyState == EventSource.CONNECTING) {
        console.log(
          `Reconnecting (readyState=${this.eventSource.readyState})...`
        );
      } else if (this.isClosed) {
        console.log(
          `Connection closed (readyState=${this.eventSource?.readyState})`
        );
      } else {
        console.log(`An error has occured`);
      }
    };

    this.eventSource.onmessage = (e: MessageEvent) => {
      console.log('Event: message, data: ' + e.data);
    };
  }

  stop() {
    if (this.eventSource) {
      this.eventSource.close();
      if (this.isClosed) {
        console.log('Connection closed');
        this.eventSource = undefined;
      }
    }
  }
}
>>>>>>> origin/main
