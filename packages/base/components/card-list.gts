import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';

import {
  CardContainer,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';

import { cn, eq, and } from '@cardstack/boxel-ui/helpers';

import { removeFileExtension, type Query } from '@cardstack/runtime-common';

import type { CardContext, BoxComponent, Format, BaseDef } from '../card-api';
import type { PrerenderedCardLike } from '@cardstack/runtime-common';

interface Signature {
  Args: {
    context?: CardContext;
    query?: Query;
    realms: string[];
    isLive?: boolean;
    format: Format;
    cards?: BoxComponent & BoxComponent[];
    viewOption?: string;
    enableHydration?: boolean;
  };
  Blocks: {
    loading: [];
    emptyState: [];
  };
  Element: HTMLElement;
}

export default class CardList extends Component<Signature> {
  @tracked hydratedCardId: string | undefined;
  cardResource = this.args.context?.getCard(this, () => this.hydratedCardId);

  get enableHydration() {
    return this.args.enableHydration ?? false;
  }

  @action
  async hydrateCard(card: PrerenderedCardLike | undefined) {
    if (!this.enableHydration) return;

    if (!card) {
      this.hydratedCardId = undefined;
      return;
    }
    const cardId = removeFileExtension(card.url);
    this.hydratedCardId = cardId;
  }

  @action
  viewCard(card: PrerenderedCardLike) {
    if (!this.args.context?.actions?.viewCard) {
      throw new Error('viewCard action is not available');
    }
    this.args.context?.actions?.viewCard?.(new URL(card.url), 'isolated');
  }

  @action
  isHydrated(cardUrl: string): boolean {
    return removeFileExtension(cardUrl) === this.hydratedCardId;
  }

  @action
  getComponent(card: BaseDef) {
    return card.constructor.getComponent(card);
  }

  <template>
    {{#if @query}}
      <@context.prerenderedCardSearchComponent
        @query={{@query}}
        @format={{@format}}
        @realms={{@realms}}
        @isLive={{@isLive}}
      >
        <:loading>
          {{#if (has-block 'loading')}}
            {{yield to='loading'}}
          {{else}}
            <LoadingIndicator />
          {{/if}}
        </:loading>
        <:response as |cards|>
          <ul
            class={{cn
              'boxel-card-list'
              grid-view=(eq @viewOption 'grid')
              strip-view=(eq @viewOption 'strip')
              card-view=(eq @viewOption 'card')
              single-column-view=(eq cards.length 0)
            }}
            ...attributes
          >
            {{#if (eq cards.length 0)}}
              <li class='empty-state-container'>
                {{#if (has-block 'emptyState')}}
                  {{yield to='emptyState'}}
                {{else}}
                  <p>No results were found</p>
                {{/if}}
              </li>
            {{else}}
              {{#each cards key='url' as |card|}}
                {{! 
                  Hydrated Card Rendering (Interactive)
                  When enableHydration is true, cards can be dynamically loaded and become interactive
                }}
                {{#if this.enableHydration}}
                  <li
                    class={{cn
                      'boxel-card-list-item'
                      instance-error=card.isError
                    }}
                    data-test-instance-error={{card.isError}}
                    data-test-cards-grid-item={{removeFileExtension card.url}}
                    data-cards-grid-item={{removeFileExtension card.url}}
                  >
                    {{! 
                      Check if this specific card is hydrated (loaded and ready for interaction)
                      and if the card resource has finished loading
                    }}
                    {{#if
                      (and
                        (this.isHydrated card.url) this.cardResource.isLoaded
                      )
                    }}
                      {{#if this.cardResource.card}}
                        {{#let
                          (this.getComponent this.cardResource.card)
                          as |Component|
                        }}
                          <CardContainer
                            class='card-item {{@format}}-card-item'
                            @displayBoundaries={{true}}
                            {{on 'click' (fn this.viewCard card)}}
                          >
                            <Component />
                          </CardContainer>
                        {{/let}}
                      {{/if}}
                    {{else}}
                      {{! 
                        Render the static card preview with hover-to-hydrate behavior
                      }}
                      <CardContainer
                        class='card-item {{@format}}-card-item'
                        @displayBoundaries={{true}}
                        {{on 'mouseenter' (fn this.hydrateCard card)}}
                        {{on 'mouseleave' (fn this.hydrateCard undefined)}}
                      >
                        <card.component />
                      </CardContainer>
                    {{/if}}
                  </li>
                {{else}}
                  <li
                    class={{cn
                      'boxel-card-list-item'
                      instance-error=card.isError
                    }}
                    {{@context.cardComponentModifier
                      cardId=card.url
                      format='data'
                      fieldType=undefined
                      fieldName=undefined
                    }}
                    data-test-instance-error={{card.isError}}
                    data-test-cards-grid-item={{removeFileExtension card.url}}
                    {{! 
                      In order to support scrolling cards into view we use a selector 
                      that is not pruned out in production builds 
                    }}
                    data-cards-grid-item={{removeFileExtension card.url}}
                  >
                    <CardContainer
                      class='card-item {{@format}}-card-item'
                      @displayBoundaries={{true}}
                    >
                      <card.component />
                    </CardContainer>
                  </li>
                {{/if}}
              {{/each}}
            {{/if}}
          </ul>
        </:response>
      </@context.prerenderedCardSearchComponent>
    {{else if @cards}}
      <ul
        class={{cn
          'boxel-card-list'
          grid-view=(eq @viewOption 'grid')
          strip-view=(eq @viewOption 'strip')
          card-view=(eq @viewOption 'card')
        }}
        ...attributes
      >
        {{#each @cards key='id' as |Card|}}
          <li class='boxel-card-list-item'>
            <Card @format={{@format}} class='card-item {{@format}}-card-item' />
          </li>
        {{/each}}
      </ul>
    {{/if}}

    <style scoped>
      .boxel-card-list {
        --padding: var(--boxel-card-list-padding, var(--boxel-sp));
        --gap: var(--boxel-card-list-gap, var(--boxel-sp));

        display: grid;
        align-content: start;
        gap: var(--gap);
        list-style-type: none;
        margin-block: 0;
        padding: var(--padding);
      }
      .grid-view {
        --item-width: 10.625rem; /* 170px */
        --item-height: 15.625rem; /* 250px */
        grid-template-columns: repeat(auto-fill, var(--item-width));
      }
      .strip-view {
        --item-height: 6.563rem; /* 105px; */
        grid-template-columns: repeat(
          auto-fill,
          minmax(calc(50% - var(--gap) / 2), 1fr)
        );
      }
      .card-view {
        --item-height: auto;
      }
      .single-column-view {
        grid-template-columns: 1fr;
      }
      .boxel-card-list-item {
        max-width: 100%;
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp) var(--boxel-sp-lg);
        width: var(--item-width);
        height: var(--item-height);
      }

      .boxel-card-list-item > :deep(.fitted-card-item) {
        container-name: fitted-card;
        container-type: size;
        height: 100%;
        width: 100%;
      }
      .boxel-card-list-item > :deep(.fitted-card-item .fitted-format) {
        height: 100%;
      }
      .boxel-card-list-item > :deep(.atom-card-item) {
        width: fit-content;
        max-width: 100%;
      }
      .boxel-card-list-item > :deep(.embedded-card-item) {
        width: 100%;
        height: auto;
        max-width: var(--embedded-card-max-width);
        min-height: var(--embedded-card-min-height);
      }
      .boxel-card-list-item > :deep(.card-item) {
        container-name: fitted-card;
        container-type: size;
        transition: ease 0.2s;
      }
      .boxel-card-list-item > :deep(.card-item:hover) {
        cursor: pointer;
        border: 1px solid var(--boxel-purple);
        transform: translateY(-1px);
      }
      .instance-error {
        position: relative;
      }
      .instance-error::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(255, 0, 0, 0.1);
      }
      .instance-error .boundaries {
        box-shadow: 0 0 0 1px var(--boxel-error-300);
      }
      .instance-error:hover .boundaries {
        box-shadow: 0 0 0 1px var(--boxel-dark);
      }
    </style>
  </template>
}
