import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import Transition from '@ember/routing/transition';
import { service } from '@ember/service';

import ENV from '@cardstack/host/config/environment';

export type ErrorModel = {
  message: string;
  loadType: 'index' | 'card' | 'stack';
  operatorModeState: string;
};

const { hostsOwnAssets } = ENV;

export default class Card extends Route<void> {
  @service declare router: RouterService;

  async beforeModel(transition: Transition) {
    let path = transition.to?.params?.path;

    if (hostsOwnAssets) {
      await this.router.replaceWith('index', {});
    } else {
      await this.router.replaceWith('index', {
        queryParams: { card: `${window.origin}/${path}` },
      });
    }
  }
}
