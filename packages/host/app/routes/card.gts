import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import Transition from '@ember/routing/transition';
import { service } from '@ember/service';

import { RealmPaths } from '@cardstack/runtime-common';

import type HostModeService from '@cardstack/host/services/host-mode-service';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type StoreService from '@cardstack/host/services/store';

export type ErrorModel = {
  message: string;
  loadType: 'index' | 'card' | 'stack';
  operatorModeState: string;
};

export default class Card extends Route<void> {
  @service declare hostModeService: HostModeService;
  @service declare realmServer: RealmServerService;
  @service declare router: RouterService;
  @service declare store: StoreService;

  async beforeModel(transition: Transition) {
    if (this.hostModeService.isActive) {
      return this.realmServer.availableRealmsAreReady;
    } else {
      let path = transition.to?.params?.path;

      transition.abort();

      await this.router.replaceWith('index', {
        queryParams: { cardPath: path },
      });
    }
  }

  async model(params: { path: string }): Promise<void> {
    let segments = params.path.split('/').filter(Boolean); // Remove empty segments from potential leading/trailing slashes
    let realm = segments[0];
    let remainingPath = segments.slice(1).join('/');

    // FIXME this is a hack and won’t work in many circumstances
    let matchingRealm = this.realmServer.availableRealmsFIXME.find(
      (availableRealm) => availableRealm.url.endsWith(`/${realm}/`),
    );

    if (!matchingRealm) {
      throw new Error(`Realm not found: ${realm}`);
    }

    let cardUrl = `${matchingRealm.url}${remainingPath}`;
    return this.store.get(cardUrl);
  }
}
