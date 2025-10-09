import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import Transition from '@ember/routing/transition';
import { service } from '@ember/service';

import type HostModeService from '@cardstack/host/services/host-mode-service';
import HostModeStateService from '@cardstack/host/services/host-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type StoreService from '@cardstack/host/services/store';

export type ErrorModel = {
  message: string;
  loadType: 'index' | 'card' | 'stack';
  operatorModeState: string;
};

export default class Card extends Route<ReturnType<StoreService['get']>> {
  queryParams = {
    hostModeStack: {
      refreshModel: true,
    },
  } as const;

  @service declare hostModeService: HostModeService;
  @service declare hostModeStateService: HostModeStateService;
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

  async model(params: { path: string; hostModeStack?: string }) {
    let cardUrl = `${this.hostModeService.hostModeOrigin}/${params.path}`;

    return this.store.get(cardUrl);
  }

  async afterModel(
    model: ReturnType<StoreService['get']>,
    transition: Transition,
  ) {
    await super.afterModel(model, transition);

    if (!this.hostModeService.isActive) {
      return;
    }

    let stackParam = transition.to?.queryParams?.hostModeStack as
      | string
      | undefined;
    let primaryCardId = (model && 'id' in model ? model.id : null) as
      | string
      | null;
    let routePath = (transition.to?.params?.path as string) ?? '';

    this.hostModeStateService.restore({
      primaryCardId,
      routePath,
      serializedStack: stackParam,
    });
  }
}
