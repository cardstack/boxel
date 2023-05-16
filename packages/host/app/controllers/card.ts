import Controller from '@ember/controller';
import { withPreventDefault } from '../helpers/with-prevent-default';
import { service } from '@ember/service';
import type RouterService from '@ember/routing/router-service';
import { action } from '@ember/object';

import { tracked } from '@glimmer/tracking';
import { ComponentLike } from '@glint/template';
import { Model } from '@cardstack/host/routes/card';
import { registerDestructor } from '@ember/destroyable';
import type { Query } from '@cardstack/runtime-common/query';
import { getSearchResults, type Search } from '../resources/search';

export default class CardController extends Controller {
  isolatedCardComponent: ComponentLike | undefined;
  withPreventDefault = withPreventDefault;
  @service declare router: RouterService;
  @tracked operatorModeEnabled = false;
  @tracked model: Model | undefined;
  @tracked results: Search | undefined;

  constructor() {
    super(...arguments);
    (globalThis as any)._CARDSTACK_CARD_SEARCH = this;
    registerDestructor(this, () => {
      delete (globalThis as any)._CARDSTACK_CARD_SEARCH;
    });
  }

  get getIsolatedComponent() {
    if (this.model) {
      return this.model.constructor.getComponent(this.model, 'isolated');
    }

    return null;
  }

  @action
  runSearch(query: Query): Search {
    this.results = getSearchResults(this, () => query);
    return this.results;
  }

  @action
  toggleOperatorMode() {
    this.operatorModeEnabled = !this.operatorModeEnabled;
  }

  @action
  closeOperatorMode() {
    this.operatorModeEnabled = false;
  }
}
