import Controller from '@ember/controller';
import ENV from '@cardstack/host/config/environment';
import { withPreventDefault } from '../helpers/with-prevent-default';
import { service } from '@ember/service';
import type RouterService from '@ember/routing/router-service';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
const { isLocalRealm } = ENV;

export default class CardController extends Controller {
  isLocalRealm = isLocalRealm;
  model: any;
  withPreventDefault = withPreventDefault;
  @tracked operatorModeEnabled = false;
  @service declare router: RouterService;

  @action
  toggleOperatorMode() {
    this.operatorModeEnabled = !this.operatorModeEnabled;
  }
}
