import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { service } from '@ember/service';
import LoaderService from '../services/loader-service';
import type CardService from '../services/card-service';
import { RealmPaths } from '@cardstack/runtime-common';

export default class _MessageController extends Controller {
  @service declare cardService: CardService;
  @service declare loaderService: LoaderService;
  @tracked eventSource: EventSource | null = null;

  constructor() {
    super(...arguments);
    // this.start();
  }

  @action async start() {
    let realmPath = new RealmPaths(this.cardService.defaultURL);
    if (
      !this.eventSource ||
      this.eventSource.readyState === EventSource.CLOSED
    ) {
      console.log('Created new event source');
      this.eventSource = new EventSource(`${realmPath.url}_message`);
    }

    this.eventSource.onopen = function (_e) {
      console.log('Connection open');
    };

    this.eventSource.onerror = function (_e) {
      if (this.readyState == EventSource.CONNECTING) {
        console.log(`Reconnecting (readyState=${this.readyState})...`);
      } else {
        console.log('Error has occured');
      }
    };

    this.eventSource.onmessage = function (e) {
      console.log('Event: message, data: ' + e.data);
    };
  }

  @action stop() {
    if (!this.eventSource) {
      console.log('No connection to close');
      return;
    }

    if (this.eventSource.readyState === EventSource.CLOSED) {
      console.log('Connection is already closed');
      return;
    }

    console.log('Closing connection...');
    this.eventSource.close();
    if (this.eventSource.readyState === EventSource.CLOSED) {
      console.log(
        `Connection closed (readyState=${this.eventSource.readyState})`
      );
    }
  }
}
