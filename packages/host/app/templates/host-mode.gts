import { inject as service } from '@ember/service';
import Component from '@glimmer/component';

import { pageTitle } from 'ember-page-title';

import { consume } from 'ember-provide-consume-context';
import RouteTemplate from 'ember-route-template';

import {
  type getCard,
  type getCards,
  type getCardCollection,
  type CardErrorJSONAPI,
  GetCardContextName,
  GetCardsContextName,
  GetCardCollectionContextName,
} from '@cardstack/runtime-common';

import CardRenderer from '@cardstack/host/components/card-renderer';

import type StoreService from '@cardstack/host/services/store';

import type { CardContext } from 'https://cardstack.com/base/card-api';

// FIXME copied from StackItem component
type StackItemCardContext = Omit<CardContext, 'prerenderedCardSearchComponent'>;

interface HostModeComponentSignature {
  Args: {
    model: ReturnType<getCard>;
  };
}

class HostModeComponent extends Component<HostModeComponentSignature> {
  @consume(GetCardContextName) private declare getCard: getCard;
  @consume(GetCardsContextName) private declare getCards: getCards;
  @consume(GetCardCollectionContextName)
  private declare getCardCollection: getCardCollection;

  @service private declare store: StoreService;

  get isError() {
    return isCardErrorJSONAPI(this.args.model);
  }

  private get cardContext(): StackItemCardContext {
    return {
      getCard: this.getCard,
      getCards: this.getCards,
      getCardCollection: this.getCardCollection,
      store: this.store,
    };
  }

  <template>
    {{pageTitle 'FIXME'}}
    {{#if this.isError}}
      <div data-test-error='not-found'>
        Card not found:
        {{@model.id}}
      </div>
    {{else}}
      <CardRenderer
        class='stack-item-preview'
        @card={{@model}}
        @format='isolated'
        @cardContext={{this.cardContext}}
      />

    {{/if}}
  </template>
}

export default RouteTemplate(HostModeComponent);

function isCardErrorJSONAPI(model: any): model is CardErrorJSONAPI {
  return model.status;
}
