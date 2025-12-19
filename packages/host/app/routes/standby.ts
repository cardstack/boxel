import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';

import { registerBoxelTransitionTo } from '../utils/register-boxel-transition';

export default class StandbyRoute extends Route {
  @service declare router: RouterService;

  async beforeModel() {
    registerBoxelTransitionTo(this.router);
  }
}
