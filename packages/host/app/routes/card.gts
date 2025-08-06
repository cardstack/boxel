import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import Transition from '@ember/routing/transition';
import { service } from '@ember/service';

import config from '@cardstack/host/config/environment';

import type HostModeService from '@cardstack/host/services/host-mode-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type StoreService from '@cardstack/host/services/store';

export type ErrorModel = {
  message: string;
  loadType: 'index' | 'card' | 'stack';
  operatorModeState: string;
};

export default class Card extends Route<ReturnType<StoreService['get']>> {
  @service declare hostModeService: HostModeService;
  @service declare realm: RealmService;
  @service declare realmServer: RealmServerService;
  @service declare router: RouterService;
  @service declare store: StoreService;

  async beforeModel(transition: Transition) {
    if (this.hostModeService.isActive) {
      return this.realmServer.ready;
    } else {
      let path = transition.to?.params?.path;

      await this.router.replaceWith('index', {
        queryParams: { cardPath: path },
      });
    }
  }

  async model(params: { path: string }) {
    let cardUrl = `${this.hostModeService.hostModeOrigin}/${params.path}`;

    return this.store.get(cardUrl);
  }
}
