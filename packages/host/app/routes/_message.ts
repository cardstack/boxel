import Route from '@ember/routing/route';
import { service } from '@ember/service';
import LoaderService from '../services/loader-service';
import type RouterService from '@ember/routing/router-service';
import type CardService from '../services/card-service';
import { RealmPaths } from '@cardstack/runtime-common';

export default class _Message extends Route {
  @service declare router: RouterService;
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;

  async model() {
    let realmPath = new RealmPaths(this.cardService.defaultURL);
    return await this.loaderService.loader.fetch(`${realmPath.url}_message`);
  }
}
