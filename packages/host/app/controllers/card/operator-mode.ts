import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { service } from '@ember/service';
import type RouterService from '@ember/routing/router-service';

export default class CardOperatorModeController extends Controller {
  @tracked operatorModeEnabled = false;
  model: any;
  @service declare router: RouterService;

  @action
  goToCard() {
    this.router.transitionTo('card', this.model);
  }
}
