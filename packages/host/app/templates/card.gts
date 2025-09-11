import { getOwner } from '@ember/owner';
import type RouterService from '@ember/routing/router-service';
import { inject as service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';

import { isDevelopingApp } from '@embroider/macros';

import { modifier } from 'ember-modifier';
import { pageTitle } from 'ember-page-title';

import { provide } from 'ember-provide-consume-context';
import RouteTemplate from 'ember-route-template';
import window from 'ember-window-mock';

import { CardContainer } from '@cardstack/boxel-ui/components';

import {
  type CardErrorJSONAPI,
  GetCardContextName,
  GetCardsContextName,
  GetCardCollectionContextName,
  isCardErrorJSONAPI,
  CardContextName,
  CommandContextName,
} from '@cardstack/runtime-common';
import { meta } from '@cardstack/runtime-common/constants';

import CardRenderer from '@cardstack/host/components/card-renderer';
import PrerenderedCardSearch from '@cardstack/host/components/prerendered-card-search';

import config from '@cardstack/host/config/environment';

import type IndexController from '@cardstack/host/controllers/index';

import { getCardCollection } from '@cardstack/host/resources/card-collection';
import { getCard } from '@cardstack/host/resources/card-resource';
import { getSearch } from '@cardstack/host/resources/search';

import type CommandService from '@cardstack/host/services/command-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type StoreService from '@cardstack/host/services/store';

import type { CardContext, CardDef } from 'https://cardstack.com/base/card-api';

export interface HostModeComponentSignature {
  Args: {
    model: CardDef | CardErrorJSONAPI;
  };
}

export class HostModeComponent extends Component<HostModeComponentSignature> {
  @service private declare commandService: CommandService;
  @service private declare matrixService: MatrixService;
  @service private declare router: RouterService;
  @service private declare store: StoreService;

  @provide(GetCardContextName)
  private get getCard() {
    return getCard;
  }

  @provide(GetCardsContextName)
  private get getCards() {
    return getSearch;
  }

  @provide(GetCardCollectionContextName)
  private get getCardCollection() {
    return getCardCollection;
  }

  @provide(CommandContextName)
  private get commandContext() {
    return this.commandService.commandContext;
  }

  get connectUrl() {
    return `${config.realmServerURL}connect`;
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
  // @ts-expect-error 'context' is declared but not used
  private get context(): CardContext {
    return {
      getCard: this.getCard,
      getCards: this.getCards,
      getCardCollection: this.getCardCollection,
      store: this.store,
      commandContext: this.commandContext,
      prerenderedCardSearchComponent: PrerenderedCardSearch,
    };
  }

  addMessageListener = modifier((element: HTMLElement) => {
    let messageHandler = async (event: MessageEvent) => {
      if (eventHasInvalidOrigin(event)) {
        console.log(
          'ignoring message from invalid origin',
          event.data,
          event.origin,
        );
        return;
      } else {
        console.log(
          'received message, origin validated',
          event.data,
          event.origin,
        );
      }
      if (event.data === 'ready') {
        element.classList.remove('not-loaded');
      } else if (event.data === 'login') {
        let indexController = getOwner(this)!.lookup(
          'controller:index',
        ) as IndexController;

        let transitionQueryParameters = new URLSearchParams({
          authRedirect: window.location.href,
        });

        if (indexController.hostModeOrigin) {
          transitionQueryParameters.set(
            'hostModeOrigin',
            indexController.hostModeOrigin,
          );
        }

        await this.matrixService.ready;

        let loginUrl = new URL(config.realmServerURL);
        loginUrl.search = transitionQueryParameters.toString();
        window.location.href = loginUrl.toString();
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

function eventHasInvalidOrigin(event: MessageEvent) {
  if (isDevelopingApp()) {
    // During development, allow messages from any origin
    return false;
  }

  if (!config.validPublishedRealmDomains) {
    // If no valid domains are configured, reject all messages
    return true;
  }

  let validDomainRoots = config.validPublishedRealmDomains.split(',');

  return validDomainRoots.some((domainRoot) => {
    return new URL(event.origin).hostname.endsWith(domainRoot.trim());
  });
}
