import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import Transition from '@ember/routing/transition';
import { service } from '@ember/service';

export type ErrorModel = {
  message: string;
  loadType: 'index' | 'card' | 'stack';
  operatorModeState: string;
};

export default class Card extends Route<void> {
  @service declare router: RouterService;

  async beforeModel(transition: Transition) {
    let path = transition.to?.params?.path;

    await this.router.replaceWith('index', {
      queryParams: { cardPath: path },
    });
  }
}
