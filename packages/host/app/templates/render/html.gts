import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

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

import SearchResults from '@cardstack/host/components/search/search-results';
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

  <template>
    {{! Whitespace-preserving container for markdown-format renders (CS-10781).
        `white-space: pre` keeps newlines and indentation authored in the
        `<template>` body intact. The dedicated `data-markdown-render-container`
        attribute gives the prerender extraction a tight target so surrounding
        route-template whitespace does not leak into the captured markdown.
        Only applies when format === 'markdown'; other formats are unaffected. }}
    {{#if (eq @model.format 'markdown')}}
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
