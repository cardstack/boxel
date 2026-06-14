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
  RenderAncestryContextName,
} from '@cardstack/runtime-common';

import PrerenderedCardSearch from '@cardstack/host/components/prerendered-card-search';
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

  // Start the render-ancestry cycle guard with an EMPTY set: the card being
  // rendered has no ancestors above it, so it must render in its requested
  // format. Each field component beneath extends the set with its own card id
  // as it descends (see RenderAncestryProvider), so a descendant that links
  // back to a card already on the spine degrades to a bounded atom stand-in
  // instead of recursing forever. Seeding the root's own id here would make the
  // root match its own cycle check and collapse to an atom.
  @provide(RenderAncestryContextName)
  // @ts-ignore "renderAncestry" is declared but only read via the context system
  private get renderAncestry(): Set<string> {
    return new Set<string>();
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
