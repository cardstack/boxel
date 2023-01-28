import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import LoaderService from '../services/loader-service';
import type CardService from '../services/card-service';
import { RealmPaths } from '@cardstack/runtime-common';

export default class MessageService extends Service {
  @service declare cardService: CardService;
  @service declare loaderService: LoaderService;
  @tracked eventSource: EventSource | null = null;
  @tracked message: string | undefined = undefined;

  start() {
    let realmPath = new RealmPaths(this.cardService.defaultURL);
    if (
      !this.eventSource ||
      this.eventSource.readyState === EventSource.CLOSED
    ) {
      this.eventSource = new EventSource(`${realmPath.url}_message`);
      console.log('Created new event source');
    }

    this.eventSource.onopen = function (_e) {
      console.log('Connection open');
    };

    this.eventSource.onerror = function (e) {
      if (this.readyState == EventSource.CONNECTING) {
        console.log(`Reconnecting (readyState=${this.readyState})...`);
      } else {
        console.log(`Error has occured, ${JSON.stringify(e)}`);
      }
    };

    this.eventSource.onmessage = (e) => {
      console.log('Event: message, data: ' + e.data);
      this.message = e.data !== 'undefined' ? e.data : undefined;
    };
  }
}
