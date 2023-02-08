import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import type CardService from '../services/card-service';
import { RealmPaths } from '@cardstack/runtime-common';

export interface EventMessage {
  url: string;
  event: string;
}

export default class MessageService extends Service {
  @service declare cardService: CardService;
  @tracked eventSource: EventSource | undefined;
  @tracked message: EventMessage | undefined;

  get isClosed() {
    return this.eventSource?.readyState === EventSource.CLOSED;
  }

  clearMessage() {
    this.message = undefined;
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

    this.eventSource.addEventListener('create', (e: MessageEvent) => {
      if (!this.message || this.message.url !== e.data) {
        this.message = { url: e.data, event: 'create' };
      }
    });

    this.eventSource.addEventListener('patch', (e: MessageEvent) => {
      if (!this.message || this.message.url !== e.data) {
        this.message = { url: e.data, event: 'patch' };
      }
    });

    this.eventSource.addEventListener('remove', (e: MessageEvent) => {
      this.message = { url: e.data, event: 'remove' };
    });

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
