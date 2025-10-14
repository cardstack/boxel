import { action } from '@ember/object';
import { getOwner } from '@ember/owner';
import type RouterService from '@ember/routing/router-service';
import { inject as service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import { isDevelopingApp } from '@embroider/macros';
import Component from '@glimmer/component';

import { modifier } from 'ember-modifier';
import { pageTitle } from 'ember-page-title';

import { provide } from 'ember-provide-consume-context';
import RouteTemplate from 'ember-route-template';
import window from 'ember-window-mock';

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

import HostModeContent from '@cardstack/host/components/host-mode/content';

import PrerenderedCardSearch from '@cardstack/host/components/prerendered-card-search';

import config from '@cardstack/host/config/environment';

import type IndexController from '@cardstack/host/controllers/index';

import { getCardCollection } from '@cardstack/host/resources/card-collection';
import { getCard } from '@cardstack/host/resources/card-resource';
import { getSearch } from '@cardstack/host/resources/search';

import type CommandService from '@cardstack/host/services/command-service';
import HostModeStateService from '@cardstack/host/services/host-mode-state-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type StoreService from '@cardstack/host/services/store';

import type {
  CardContext,
  CardDef,
  ViewCardFn,
} from 'https://cardstack.com/base/card-api';

export interface HostModeComponentSignature {
  Args: {
    model: CardDef | CardErrorJSONAPI | undefined;
  };
}

export class HostModeComponent extends Component<HostModeComponentSignature> {
  @service private declare commandService: CommandService;
  @service private declare hostModeStateService: HostModeStateService;
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
    return `${config.realmServerURL}connect/${encodeURIComponent(
      window.location.origin,
    )}`;
  }

  get isError() {
    return this.args.model ? isCardErrorJSONAPI(this.args.model) : false;
  }

  get card() {
    if (this.isError) {
      return undefined;
    }

    return this.args.model as CardDef;
  }

  get title() {
    if (this.isError) {
      return `Card not found: ${this.args.model?.id}`;
    }

    return this.card?.title ?? '';
  }

  get backgroundImageStyle() {
    let backgroundImageUrl = this.card?.[meta]?.realmInfo?.backgroundURL;

    if (backgroundImageUrl) {
      return htmlSafe(`background-image: url(${backgroundImageUrl});`);
    }
    return htmlSafe('');
  }

  get hostModeContainerClass() {
    if (this.isError) {
      return 'host-mode-container';
    }

    // Check if the card prefers wide format
    if (
      this.card &&
      (this.card.constructor as typeof CardDef).prefersWideFormat
    ) {
      return 'host-mode-container is-wide';
    }

    return 'host-mode-container';
  }

  private viewCard: ViewCardFn = (cardOrURL) => {
    let cardId = cardOrURL instanceof URL ? cardOrURL.href : cardOrURL.id;
    if (!cardId) {
      return;
    }

    let normalizedId = cardId.replace(/\.json$/, '');
    this.hostModeStateService.pushCard(normalizedId);
  };

  @action
  removeCardFromStack(cardId: string) {
    this.hostModeStateService.removeCardFromStack(cardId);
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
      if (eventHasValidOrigin(event)) {
        console.debug(
          'received message, origin validated',
          event.data,
          event.origin,
        );
      } else {
        console.debug(
          'ignoring message from invalid origin',
          event.data,
          event.origin,
        );

        return;
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

      <div class='host-wrapper'>
        <section
          class={{this.hostModeContainerClass}}
          style={{this.backgroundImageStyle}}
          data-test-host-mode-container
        >
          <HostModeContent
            @primaryCardId={{this.hostModeStateService.primaryCard}}
            @stackItemCardIds={{this.hostModeStateService.stackItems}}
            @removeCardFromStack={{this.removeCardFromStack}}
            @viewCard={{this.viewCard}}
            class='full-host-mode-content'
          />
        </section>
      </div>
    {{/if}}

    <style scoped>
      .host-wrapper {
        position: relative;
        min-height: 100vh;
      }

      .host-mode-container {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100%;
        background-position: center;
        background-size: cover;
        padding: var(--boxel-sp);
      }

      .host-mode-container.is-wide {
        padding: 0;
      }

      .full-host-mode-content {
        min-height: 100vh;
      }
    </style>
  </template>
}

export default RouteTemplate(HostModeComponent);

function eventHasValidOrigin(event: MessageEvent) {
  if (isDevelopingApp()) {
    // During development, allow messages from any origin
    return true;
  }

  return new URL(config.realmServerURL).href.startsWith(event.origin);
}
