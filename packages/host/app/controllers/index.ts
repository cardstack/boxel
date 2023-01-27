import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { service } from '@ember/service';
import LoaderService from '../services/loader-service';
import type CardService from '../services/card-service';
import { RealmPaths } from '@cardstack/runtime-common';

export default class IndexController extends Controller {
  @service declare cardService: CardService;
  @service declare loaderService: LoaderService;
  @tracked eventSource: EventSource | null = null;

  @action async start() {
    let realmPath = new RealmPaths(this.cardService.defaultURL);
    this.eventSource = new EventSource(`${realmPath.url}_message`);

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

    this.eventSource.addEventListener('bye', function (e) {
      console.log('Event: bye, data: ' + e.data);
    });

    this.eventSource.onmessage = function (e) {
      console.log('Event: message, data: ' + e.data);
    };
  }

  @action stop() {
    console.log('Closing connection...');
    this.eventSource?.close();
    if (this.eventSource?.readyState === EventSource.CLOSED) {
      console.log(
        `Connection closed (readyState=${this.eventSource.readyState})`
      );
    }
  }
}
