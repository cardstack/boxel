import { service } from '@ember/service';
import Component from '@glimmer/component';

import { provide } from 'ember-provide-consume-context';
import RouteTemplate from 'ember-route-template';

import { eq } from '@cardstack/boxel-ui/helpers';

import {
  type getCard as GetCardType,
  GetCardContextName,
  GetCardsContextName,
  GetCardCollectionContextName,
  CardContextName,
} from '@cardstack/runtime-common';

import SearchResults from '@cardstack/host/components/card-search/search-results';
import { getCardCollection } from '@cardstack/host/resources/card-collection';
import { getCard } from '@cardstack/host/resources/card-resource';
import type RenderStoreService from '@cardstack/host/services/render-store';

import type { CardContext } from 'https://cardstack.com/base/card-api';

import type { Model } from '../../routes/render/html';

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
