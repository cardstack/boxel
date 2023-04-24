import Controller from '@ember/controller';
import ENV from '@cardstack/host/config/environment';
import { withPreventDefault } from '../helpers/with-prevent-default';
import { service } from '@ember/service';
import type RouterService from '@ember/routing/router-service';
import { action } from '@ember/object';
//import { isCard } from 'https://cardstack.com/base/card-api';

const { isLocalRealm } = ENV;

export default class CardController extends Controller {
  isLocalRealm = isLocalRealm;
  model: any;
  withPreventDefault = withPreventDefault;
  @service declare router: RouterService;

  get getIsolatedComponent() {
    return this.model.card ? this.model.card.constructor.getComponent(this.model.card, 'isolated') : this.model.component;
  }

  @action
  goToOperatorMode() {
    this.router.transitionTo('card.operator-mode', this.model);
  }
}
