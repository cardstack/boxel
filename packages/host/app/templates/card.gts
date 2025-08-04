import { inject as service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';

import { pageTitle } from 'ember-page-title';

import { consume, provide } from 'ember-provide-consume-context';
import RouteTemplate from 'ember-route-template';

import { CardContainer } from '@cardstack/boxel-ui/components';

import {
  type getCard,
  type getCards,
  type getCardCollection,
  type CardErrorJSONAPI,
  GetCardContextName,
  GetCardsContextName,
  GetCardCollectionContextName,
  isCardErrorJSONAPI,
  CardContextName,
} from '@cardstack/runtime-common';
import { meta } from '@cardstack/runtime-common/constants';

import CardRenderer from '@cardstack/host/components/card-renderer';

import type StoreService from '@cardstack/host/services/store';

import type { CardContext, CardDef } from 'https://cardstack.com/base/card-api';

type HostModeCardContext = Omit<CardContext, 'prerenderedCardSearchComponent'>;

interface HostModeComponentSignature {
  Args: {
    model: CardDef | CardErrorJSONAPI;
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

  get card() {
    return this.args.model as CardDef;
  }

  get title() {
    if (this.isError) {
      return `Card not found: ${this.args.model.id}`;
    }

    return this.args.model.title;
  }

  get backgroundImageStyle() {
    let backgroundImageUrl = this.card[meta]?.realmInfo?.backgroundURL;

    if (backgroundImageUrl) {
      return htmlSafe(`background-image: url(${backgroundImageUrl});`);
    }
    return false;
  }

  @provide(CardContextName)
  private get cardContext(): HostModeCardContext {
    return {
      getCard: this.getCard,
      getCards: this.getCards,
      getCardCollection: this.getCardCollection,
      store: this.store,
    };
  }

  <template>
    {{pageTitle this.title}}
    {{#if this.isError}}
      <div data-test-error='not-found'>
        Card not found:
        {{@model.id}}
      </div>
    {{else}}
      <section
        class='host-mode-container'
        style={{this.backgroundImageStyle}}
        data-test-host-mode-container
      >
        <CardContainer class='card'>
          <CardRenderer
            class='stack-item-preview'
            @card={{this.card}}
            @format='isolated'
          />

        </CardContainer>
      </section>
    {{/if}}

    <style scoped>
      .host-mode-container {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100%;
        background-position: center;
        background-size: cover;
        padding: var(--boxel-sp);
      }

      .card {
        width: 50rem;
      }
    </style>
  </template>
}

export default RouteTemplate(HostModeComponent);
