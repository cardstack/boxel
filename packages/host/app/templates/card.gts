import { inject as service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';

import { modifier } from 'ember-modifier';
import { pageTitle } from 'ember-page-title';
import window from 'ember-window-mock';

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

  get connectUrl() {
    // FIXME this is a hack for testing at the moment
    if (window.location.host === 'published.localhost:4205') {
      return 'http://localhost:4205/connect/FIXME';
    } else {
      return 'http://localhost:4200/connect/FIXME';
    }
  }

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
  // @ts-ignore "context" is declared but not used
  private get context(): HostModeCardContext {
    return {
      getCard: this.getCard,
      getCards: this.getCards,
      getCardCollection: this.getCardCollection,
      store: this.store,
    };
  }

  addMessageListener = modifier((element: HTMLElement) => {
    let messageHandler = (event: MessageEvent) => {
      // TODO if this becomes anything more significant than just showing
      // the button, the origin should be verified.
      if (event.data === 'ready') {
        element.classList.remove('not-loaded');
      }
    };

    window.addEventListener('message', messageHandler);

    return () => {
      window.removeEventListener('message', messageHandler);
    };
  });

  <template>
    {{pageTitle this.title}}
    {{#if this.isError}}
      <div data-test-error='not-found'>
        Card not found:
        {{@model.id}}
      </div>
    {{else}}
      <iframe
        class='connect not-loaded'
        title='connect'
        src={{this.connectUrl}}
        {{this.addMessageListener}}
      />
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

      .connect {
        position: fixed;
        top: var(--boxel-sp);
        right: var(--boxel-sp);
        width: 10rem;
        height: 4rem;
        border: none;
        background: transparent;
        opacity: 1;
        transition: opacity 0.2s ease-in-out;
      }

      .connect.not-loaded {
        width: 0;
        opacity: 0;
      }
    </style>
  </template>
}

export default RouteTemplate(HostModeComponent);
