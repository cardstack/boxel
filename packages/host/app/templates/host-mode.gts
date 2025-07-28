import { action } from '@ember/object';
import { inject as service } from '@ember/service';
import Component from '@glimmer/component';

import { pageTitle } from 'ember-page-title';

import RouteTemplate from 'ember-route-template';

import type { CardContext, CardDef } from 'https://cardstack.com/base/card-api';

import CardRenderer from '@cardstack/host/components/card-renderer';

import OperatorModeContainer from '../components/operator-mode/container';

import type OperatorModeStateService from '../services/operator-mode-state-service';

import { consume } from 'ember-provide-consume-context';

import {
  type Actions,
  type Permissions,
  type getCard,
  type getCards,
  type getCardCollection,
  cardTypeDisplayName,
  PermissionsContextName,
  RealmURLContextName,
  GetCardContextName,
  GetCardsContextName,
  GetCardCollectionContextName,
  Deferred,
  cardTypeIcon,
  CommandContext,
  realmURL,
  identifyCard,
} from '@cardstack/runtime-common';

import type StoreService from '@cardstack/host/services/store';

// FIXME copied from StackItem component
type StackItemCardContext = Omit<CardContext, 'prerenderedCardSearchComponent'>;

interface HostModeComponentSignature {
  Args: {
    model: any; // FIXME
  };
}

class HostModeComponent extends Component<HostModeComponentSignature> {
  @consume(GetCardContextName) private declare getCard: getCard;
  @consume(GetCardsContextName) private declare getCards: getCards;
  @consume(GetCardCollectionContextName)
  private declare getCardCollection: getCardCollection;

  @service private declare store: StoreService;

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
    <CardRenderer
      class='stack-item-preview'
      @card={{@model}}
      @format='isolated'
      @cardContext={{this.cardContext}}
    />
  </template>
}

export default RouteTemplate(HostModeComponent);
