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
      // It shouldn’t be possible to view a card in host directly. If there's a card path present, we don't know its full URL, so we just redirect to the workspace chooser
      await this.router.replaceWith('index');
    } else {
      // In this case, host app is served by the realm server, so we can construct the full card URL from the path and redirect to index where the index route will put this card on the stack
      // (for example we will come here when visiting the link given to us by clicking "Copy card URL")
      await this.router.replaceWith('index', {
        queryParams: { card: `${window.origin}/${path}` },
      });
    }
  }
}
