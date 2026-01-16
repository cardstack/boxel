import { action } from '@ember/object';
import { getOwner } from '@ember/owner';
import type RouterService from '@ember/routing/router-service';
import { inject as service } from '@ember/service';
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
  type getCard as GetCardType,
} from '@cardstack/runtime-common';

import HostModeContent from '@cardstack/host/components/host-mode/content';
import OperatorModeContainer from '@cardstack/host/components/operator-mode/container';

import PrerenderedCardSearch from '@cardstack/host/components/prerendered-card-search';

import config from '@cardstack/host/config/environment';

import type IndexController from '@cardstack/host/controllers/index';

import { getCardCollection } from '@cardstack/host/resources/card-collection';
import { getCard } from '@cardstack/host/resources/card-resource';

import type CommandService from '@cardstack/host/services/command-service';

import type HostModeStateService from '@cardstack/host/services/host-mode-state-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type StoreService from '@cardstack/host/services/store';

import type {
  CardContext,
  CardDef,
  ViewCardFn,
} from 'https://cardstack.com/base/card-api';

import type HostModeService from '../services/host-mode-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';

export interface IndexComponentComponentSignature {
  Args: {
    model: CardDef | CardErrorJSONAPI | undefined;
  };
}

export class IndexComponent extends Component<IndexComponentComponentSignature> {
  @service private declare commandService: CommandService;
  @service private declare hostModeService: HostModeService;
  @service private declare hostModeStateService: HostModeStateService;
  @service private declare matrixService: MatrixService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare router: RouterService;
  @service private declare store: StoreService;

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

  @provide(CommandContextName)
  private get commandContext() {
    return this.commandService.commandContext;
  }

  // Remove this and onClose argument in OperatorModeContainer once we remove host mode and the card route, where closing operator mode will not be a thing anymore
  @action closeOperatorMode() {
    // noop
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
      mode: this.hostModeService.isActive ? 'host' : 'operator',
      submode: this.hostModeService.isActive
        ? 'host'
        : this.operatorModeStateService.state?.submode,
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

  // TODO: remove in CS-9977, with rehydration
  removeIsolatedMarkup = modifier(() => {
    if (typeof document === 'undefined') {
      return;
    }
    let start = document.getElementById('boxel-isolated-start');
    let end = document.getElementById('boxel-isolated-end');
    if (!start || !end) {
      return;
    }
    let node = start.nextSibling;
    while (node && node !== end) {
      let next = node.nextSibling;
      node.parentNode?.removeChild(node);
      node = next;
    }
  });

  <template>
    {{#if this.hostModeService.isActive}}
      {{pageTitle this.title}}

      {{#if this.isError}}
        <div data-test-error='not-found'>
          Card not found:
          {{@model.id}}
        </div>
      {{else}}
        <HostModeContent
          @primaryCardId={{this.hostModeStateService.primaryCard}}
          @stackItemCardIds={{this.hostModeStateService.stackItems}}
          @removeCardFromStack={{this.removeCardFromStack}}
          @viewCard={{this.viewCard}}
          class='host-mode-content'
          {{this.removeIsolatedMarkup}}
        />
      {{/if}}
    {{else}}
      {{pageTitle this.operatorModeStateService.title}}
      <OperatorModeContainer @onClose={{this.closeOperatorMode}} />
    {{/if}}

    <style scoped>
      .host-mode-content {
        height: 100%;
        position: fixed;
        top: 0;
        left: 0;
      }
    </style>
  </template>
}

export default RouteTemplate(IndexComponent);

function eventHasValidOrigin(event: MessageEvent) {
  if (isDevelopingApp()) {
    // During development, allow messages from any origin
    return true;
  }

  return new URL(config.realmServerURL).href.startsWith(event.origin);
}
