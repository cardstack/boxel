import GlimmerComponent from '@glimmer/component';

import { type CardContext, BaseDef } from 'https://cardstack.com/base/card-api';

import { type Query } from '@cardstack/runtime-common';

import { CardContainer } from '@cardstack/boxel-ui/components';

import { getCards } from '@cardstack/runtime-common';

interface CardListWithoutPrerenderedSignature {
  Args: {
    query: Query;
    realms: URL[];
    context?: CardContext;
  };
  Element: HTMLElement;
}

export class CardListWithoutPrerendered extends GlimmerComponent<CardListWithoutPrerenderedSignature> {
  cards = getCards(
    () => this.args.query,
    () => this.args.realms.map((url) => url.href),
    {
      isLive: true,
    },
  );

  <template>
    <ul class='card-list' ...attributes>
      {{#if this.cards.isLoading}}
        <div>Loading...</div>
      {{else}}
        {{#each this.cards.instances as |card|}}
          {{#let (getComponent card) as |Component|}}
            <li class='card-list-item'>
              <CardContainer
                {{@context.cardComponentModifier
                  cardId=card.id
                  format='data'
                  fieldType=undefined
                  fieldName=undefined
                }}
                class='card'
                @displayBoundaries={{true}}
              >
                <Component @format='embedded' @displayContainer={{false}} />
              </CardContainer>
            </li>
          {{/let}}
        {{/each}}
      {{/if}}
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

function getComponent(cardOrField: BaseDef) {
  return cardOrField.constructor.getComponent(cardOrField);
}
