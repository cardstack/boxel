import GlimmerComponent from '@glimmer/component';

import { type CardContext } from 'https://cardstack.com/base/card-api';

import { type Query } from '@cardstack/runtime-common';

import { CardContainer } from '@cardstack/boxel-ui/components';

interface PrerenderedCard {
  url: string;
  component: any;
}

interface CardListSignature {
  Args: {
    query: Query;
    realms: URL[];
    context?: CardContext;
  };
  Blocks: {
    meta: [card: PrerenderedCard];
  };
  Element: HTMLElement;
}
export class CardList extends GlimmerComponent<CardListSignature> {
  <template>
    <ul class='card-list' ...attributes>
      {{#let
        (component @context.prerenderedCardSearchComponent)
        as |PrerenderedCardSearch|
      }}
        <PrerenderedCardSearch
          @query={{@query}}
          @format='embedded'
          @realms={{@realms}}
          @isLive={{true}}
        >
          <:loading>
            Loading...
          </:loading>
          <:response as |cards|>
            {{#each cards key='url' as |card|}}
              <li class='card-list-item'>
                <CardContainer
                  {{@context.cardComponentModifier
                    cardId=card.url
                    format='data'
                    fieldType=undefined
                    fieldName=undefined
                  }}
                  class='card'
                  @displayBoundaries={{true}}
                >
                  <card.component />
                </CardContainer>
                {{#if (has-block 'meta')}}
                  {{yield card to='meta'}}
                {{/if}}
              </li>
            {{/each}}
          </:response>
        </PrerenderedCardSearch>
      {{/let}}
    </ul>
    <style scoped>
      .card-list {
        display: grid;
        gap: var(--boxel-sp);
        list-style-type: none;
        margin: 0;
        padding: var(--boxel-sp-6xs);
      }
      .card-list-item {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp) var(--boxel-sp-lg);
      }
      .card {
        height: auto;
        min-height: var(--embedded-card-min-height, 345px);
        max-width: var(--embedded-card-max-width, 100%);
      }
      .bordered-items > .card-list-item > * {
        border-radius: var(--boxel-border-radius);
        box-shadow: inset 0 0 0 1px var(--boxel-light-500);
      }
    </style>
  </template>
}
