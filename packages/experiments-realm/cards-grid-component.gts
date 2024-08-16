import { CardDef, type CardContext } from 'https://cardstack.com/base/card-api';

import GlimmerComponent from '@glimmer/component';
import { cn } from '@cardstack/boxel-ui/helpers';
import { PrerenderedCard } from '@cardstack/runtime-common';

import { CardContainer } from '@cardstack/boxel-ui/components';

// @ts-ignore no types
import cssUrl from 'ember-css-url';

type Instance = CardDef | PrerenderedCard;
//need to handle in templates

export class CardsGridComponent extends GlimmerComponent<{
  Args: {
    instances: Instance[] | [];
    context?: CardContext;
    isListFormat?: boolean;
  };
  Element: HTMLElement;
}> {
  <template>
    <div>
      <div class='cards-grid'>
        <ul class={{cn 'cards' list-format=@isListFormat}} ...attributes>
          {{! use "key" to keep the list stable between refreshes }}

          {{#each @instances key='id' as |card|}}
            <CardContainer class='card'>

              <li
                {{@context.cardComponentModifier
                  cardId=card.url
                  format='data'
                  fieldType=undefined
                  fieldName=undefined
                }}
                data-test-cards-grid-item={{removeFileExtension card.url}}
                {{! In order to support scrolling cards into view we use a selector that is not pruned out in production builds }}
                data-cards-grid-item={{removeFileExtension card.url}}
              >
                {{card.component}}
              </li>
            </CardContainer>
          {{/each}}
        </ul>
      </div>
    </div>
    <style>
      .card {
        width: var(--grid-card-width);
        height: var(--grid-card-height);
        overflow: hidden;
        cursor: pointer;
        container-name: embedded-card;
        container-type: size;
      }
      .cards-grid {
        --grid-card-width: 11.125rem;
        --grid-card-height: 15.125rem;

        max-width: 70rem;
        margin: 0 auto;
        padding: var(--boxel-sp-xl);
        position: relative; /* Do not change this */
      }
      .cards {
        list-style-type: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(
          auto-fit,
          minmax(var(--grid-card-width), 1fr)
        );
        gap: var(--boxel-sp);
        justify-items: center;
        height: 100%;
      }
    </style>
  </template>

  getComponent = (card: CardDef) => card.constructor.getComponent(card);
}

function removeFileExtension(cardUrl: string) {
  return cardUrl.replace(/\.[^/.]+$/, '');
}
