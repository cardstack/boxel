import { inject as service } from '@ember/service';
import Component from '@glimmer/component';

import { provide } from 'ember-provide-consume-context';
import RouteTemplate from 'ember-route-template';

import {
  type getCard as GetCardType,
  GetCardContextName,
  GetCardsContextName,
  GetCardCollectionContextName,
  CardContextName,
} from '@cardstack/runtime-common';

import PrerenderedCardSearch from '@cardstack/host/components/prerendered-card-search';
import { getCardCollection } from '@cardstack/host/resources/card-collection';
import { getCard } from '@cardstack/host/resources/card-resource';
import type RenderStoreService from '@cardstack/host/services/render-store';

import type { Model } from '../../routes/render/html';
import type { CardContext } from '@cardstack/base/card-api';

interface Signature {
  Args: {
    model: Model;
  };
}

class RenderHtmlTemplate extends Component<Signature> {
  @service('render-store') declare private store: RenderStoreService;

  @provide(GetCardContextName)
  private get getCard(): GetCardType {
    return getCard as unknown as GetCardType;
  }

  @provide(GetCardsContextName)
  private get getCards() {
    return this.store.getSearchResource.bind(this.store);
  }

  @provide(GetCardCollectionContextName)
  private get getCardCollection() {
    return getCardCollection;
  }

  @provide(CardContextName)
  // @ts-ignore "context" is declared but not used
  private get context(): CardContext {
    return {
      getCard: this.getCard,
      getCards: this.getCards,
      getCardCollection: this.getCardCollection,
      store: this.store,
      prerenderedCardSearchComponent: PrerenderedCardSearch,
      mode: 'host',
      submode: 'host',
    };
  }

  <template><@model.Component @format={{@model.format}} /></template>
}

export default RouteTemplate(RenderHtmlTemplate);
