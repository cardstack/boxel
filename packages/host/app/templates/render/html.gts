import { getOwner } from '@ember/application';
import { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';
import { provide } from 'ember-provide-consume-context';
import RouteTemplate from 'ember-route-template';

import { eq } from '@cardstack/boxel-ui/helpers';

import {
  type getCard as GetCardType,
  GetCardContextName,
  GetCardsContextName,
  GetCardCollectionContextName,
  CardContextName,
  realmURL,
  type Query,
} from '@cardstack/runtime-common';

import CardIsland from '@cardstack/host/components/card-island';
import SearchResults from '@cardstack/host/components/search/search-results';
import { CARD_ISLAND_PROTOCOL_VERSION } from '@cardstack/host/lib/card-island-protocol';
import {
  captureIsolatedRenderErrors,
  serializeWithArgs,
  settleDeferredIsolatedRenders,
  teardown,
} from '@cardstack/host/lib/isolated-render';
import { isTrustedRealmCardDefinition } from '@cardstack/host/lib/realm-sandbox-boundary';
import { getCardCollection } from '@cardstack/host/resources/card-collection';
import { getCard } from '@cardstack/host/resources/card-resource';
import type RealmSandboxService from '@cardstack/host/services/realm-sandbox';
import type RenderStoreService from '@cardstack/host/services/render-store';

import type { Model } from '../../routes/render/html';
import type { CardContext } from '@cardstack/base/card-api';

interface Signature {
  Args: {
    model: Model;
  };
}

const serializeIslandWaiter = buildWaiter('render-html:serialize-card-island');

class RenderHtmlTemplate extends Component<Signature> {
  @service('render-store') declare private store: RenderStoreService;
  @service declare private realmSandbox: RealmSandboxService;

  @provide(GetCardContextName)
  private get getCard(): GetCardType {
    return getCard as unknown as GetCardType;
  }

  // A no-realm card search during prerender targets the realm of the card
  // being rendered.
  private get currentRealm(): string | undefined {
    return this.args.model?.instance?.[realmURL]?.href;
  }

  @cached
  private get cardStore() {
    return this.store.cardFacingStore(() => this.currentRealm);
  }

  @provide(GetCardsContextName)
  private get getCards() {
    let store = this.store;
    let getDefaultRealm = () => this.currentRealm;
    return (
      parent: object,
      getQuery: () => Query | undefined,
      getRealms?: () => string[] | undefined,
      opts?: { isLive?: boolean; doWhileRefreshing?: () => void },
    ) =>
      store.getSearchResource(parent, getQuery, getRealms, {
        ...opts,
        cardInitiated: true,
        getDefaultRealm,
      });
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
      store: this.cardStore,
      searchResultsComponent: SearchResults,
      mode: 'host',
      submode: 'host',
    };
  }

  private serializeIsland = modifier(
    (element: HTMLElement, [model]: [Model]) => {
      let args = {
        card: model.instance,
        format: model.format,
        getCard: this.getCard,
        getCards: this.getCards,
        getCardCollection: this.getCardCollection,
        context: this.context,
      };
      let owner = getOwner(this)!;
      let cancelled = false;
      let waiterToken = serializeIslandWaiter.beginAsync();
      void (async () => {
        try {
          // The route template itself is a host-rendered Glimmer root. Prepare
          // only this card/format's SES program before creating the nested
          // low-level CardIsland, then start that program after the async
          // boundary has closed the host transaction.
          await this.realmSandbox.prepareRender(model.instance, model.format);
          if (cancelled) {
            return;
          }
          await captureIsolatedRenderErrors(async () => {
            serializeWithArgs(CardIsland as any, element as any, owner, args);
            await settleDeferredIsolatedRenders();
          });
        } catch (error) {
          if (!cancelled) {
            queueMicrotask(() => {
              throw error;
            });
          }
        } finally {
          serializeIslandWaiter.endAsync(waiterToken);
        }
      })();

      return () => {
        cancelled = true;
        teardown(element as any);
      };
    },
  );

  private get useTrustedDOMRenderer(): boolean {
    return isTrustedRealmCardDefinition(this.args.model.instance);
  }

  <template>
    {{! Whitespace-preserving container for markdown-format renders (CS-10781).
        `white-space: pre` keeps newlines and indentation authored in the
        `<template>` body intact. The dedicated `data-markdown-render-container`
        attribute gives the prerender extraction a tight target so surrounding
        route-template whitespace does not leak into the captured markdown.
        Only applies when format === 'markdown'; other formats are unaffected. }}
    {{#if (eq @model.format 'isolated')}}
      {{#if this.useTrustedDOMRenderer}}
        {{! Trusted official templates render through the route's normal Glimmer
            tree. Calling a nested live renderer from a modifier is re-entrant
            and can put the prerender route into an unusable state. }}
        <div
          data-boxel-card-island
          data-boxel-card-island-protocol={{CARD_ISLAND_PROTOCOL_VERSION}}
          data-boxel-card-format={{@model.format}}
          data-boxel-card-url={{@model.instance.id}}
          data-boxel-card-island-serialization='rendered'
        >
          <CardIsland
            @card={{@model.instance}}
            @format={{@model.format}}
            @getCard={{this.getCard}}
            @getCards={{this.getCards}}
            @getCardCollection={{this.getCardCollection}}
            @context={{this.context}}
          />
        </div>
      {{else}}
        <div
          data-boxel-card-island
          data-boxel-card-island-protocol={{CARD_ISLAND_PROTOCOL_VERSION}}
          data-boxel-card-format={{@model.format}}
          data-boxel-card-url={{@model.instance.id}}
          data-boxel-card-island-serialization='serialized'
          {{this.serializeIsland @model}}
        ></div>
      {{/if}}
    {{else if (eq @model.format 'markdown')}}
      <div data-markdown-render-container class='markdown-render-container'>
        <@model.Component @format={{@model.format}} />
      </div>
    {{else}}
      <@model.Component @format={{@model.format}} />
    {{/if}}
    <style scoped>
      .markdown-render-container {
        white-space: pre;
      }
    </style>
  </template>
}

export default RouteTemplate(RenderHtmlTemplate);
