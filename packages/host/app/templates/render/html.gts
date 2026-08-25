import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
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

  // Inline sizing for the envelope box. The dimensions are per-capture data
  // (they change between batch entries), so they can't live in scoped CSS.
  // `position: fixed; top/left: 0` pins the box to the viewport origin so the
  // screenshot path can size the viewport to the envelope and capture it whole,
  // independent of any body margin. `overflow: hidden` clips the fitted card to
  // the box the same way the host's fitted-card container does.
  private get envelopeStyle() {
    let envelope = this.args.model?.envelope;
    if (!envelope) {
      return undefined;
    }
    return htmlSafe(
      `position: fixed; top: 0; left: 0; box-sizing: border-box; ` +
        `width: ${envelope.width}px; height: ${envelope.height}px; ` +
        `overflow: hidden;`,
    );
  }

  <template>
    {{! Whitespace-preserving container for markdown-format renders (CS-10781).
        `white-space: pre` keeps newlines and indentation authored in the
        `<template>` body intact. The dedicated `data-markdown-render-container`
        attribute gives the prerender extraction a tight target so surrounding
        route-template whitespace does not leak into the captured markdown.
        Only applies when format === 'markdown'; other formats are unaffected. }}
    {{#if this.envelopeStyle}}
      {{! Screenshot capture of the fitted format: render the card into a
          fixed-size, non-scrolling box so its `@container fitted-card` queries
          fire against the envelope rather than the viewport. The base
          field-component wrapper (fitted-format: width/height 100%,
          container-name: fitted-card, container-type: size) fills this box
          and establishes the container, so we only supply the sized parent.
          Fitted is the only format whose wrapper does this — any future
          envelope format (e.g. atom) needs its own verified wrapper contract
          before it can join. }}
      <div data-render-envelope style={{this.envelopeStyle}}>
        <@model.Component @format={{@model.format}} />
      </div>
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
