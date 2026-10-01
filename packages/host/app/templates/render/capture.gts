import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { provide } from 'ember-provide-consume-context';
import RouteTemplate from 'ember-route-template';

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

import type { Model } from '../../routes/render/capture';
import type { CardContext } from '@cardstack/base/card-api';

interface Signature {
  Args: {
    model: Model;
  };
}

// The capture-only component gets the same author surface a format render
// gets (context provisioning mirrors the render.html template). A raster
// entry renders into a fixed-size box the capture engine sizes its viewport
// to; a pdf entry renders in the natural document flow (no box) that
// `page.pdf()` paginates under print media.
class RenderCaptureTemplate extends Component<Signature> {
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

  // Inline sizing for the raster capture box. The dimensions and background
  // are per-declaration data, so they can't live in scoped CSS. `position:
  // fixed; top/left: 0` pins the box to the viewport origin so the capture
  // engine can size the viewport to the box and capture it whole,
  // independent of any body margin. `overflow: hidden` clips the component
  // to the declared box.
  private get boxStyle() {
    let { width, height, background } = this.args.model;
    return htmlSafe(
      `position: fixed; top: 0; left: 0; box-sizing: border-box; ` +
        `width: ${width}px; height: ${height}px; ` +
        `overflow: hidden; background: ${background};`,
    );
  }

  <template>
    {{#if @model.isPdf}}
      {{! A pdf entry renders the full document flow — no capture box, no
          clipping — so print `break-*`/`@page` rules paginate it across pages
          under `page.pdf()`. A fixed-height, `overflow: hidden` box would
          truncate it to one page. There is no envelope box to size-match, but
          the slot still needs a per-slot flush signal: `display: contents`
          adds no box (so `break-*`/`@page` fragmentation is unaffected) while
          `data-render-capture` names this slot, letting the capture engine
          wait for *this* slot's render before paginating — its guard against
          paginating a prior slot's still-mounted DOM. Readiness stays the
          `data-capture-pending` signal the component owns. }}
      <div class='pdf-flow' data-render-capture={{@model.name}}>
        <@model.Component @format='isolated' />
      </div>
    {{else}}
      {{! The `data-render-envelope` attribute reuses the capture engine's
          applied-size wait (the deterministic signal that this box has laid
          out at the declared size); `data-render-capture` names the slot
          so that wait matches only this slot's envelope — the engine's guard
          against capturing a prior slot's still-mounted box when consecutive
          slots declare the same dimensions. }}
      <div
        data-render-envelope
        data-render-capture={{@model.name}}
        style={{this.boxStyle}}
      >
        <@model.Component @format='isolated' />
      </div>
    {{/if}}
    <style scoped>
      /* The pdf slot's flush marker must add no box of its own, or it would
         interpose a formatting context between the page and the component's
         `break-*`/`@page` flow. `display: contents` makes the wrapper carry
         its `data-render-capture` marker while laying out as if it were
         not there. */
      .pdf-flow {
        display: contents;
      }
    </style>
  </template>
}

export default RouteTemplate(RenderCaptureTemplate);
