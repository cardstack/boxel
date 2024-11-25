import GlimmerComponent from '@glimmer/component';

import { type CardContext } from 'https://cardstack.com/base/card-api';

import { type Query } from '@cardstack/runtime-common';

import { CardContainer } from '@cardstack/boxel-ui/components';
import { eq, not } from '@cardstack/boxel-ui/helpers';

export type ViewOption = 'card' | 'strip' | 'grid';

interface CardsGridSignature {
  Args: {
    query: Query;
    realms: URL[];
    selectedView: ViewOption;
    context?: CardContext;
  };
}
export class CardsGrid extends GlimmerComponent<CardsGridSignature> {
  get queryString() {
    return JSON.stringify(this.args.query);
  }
  <template>
    <ul class='cards {{@selectedView}}-view' data-test-cards-grid-cards>
      {{#let
        (component @context.prerenderedCardSearchComponent)
        as |PrerenderedCardSearch|
      }}
        <PrerenderedCardSearch
          @query={{@query}}
          @format='fitted'
          @realms={{@realms}}
        >
          <:loading>
            Loading...
          </:loading>
          <:response as |cards|>
            {{#each cards as |card|}}
              <li
                class='card {{@selectedView}}-view-container'
                {{@context.cardComponentModifier
                  cardId=card.url
                  format='data'
                  fieldType=undefined
                  fieldName=undefined
                }}
              >
                <CardContainer
                  class='card'
                  @displayBoundaries={{not (eq @selectedView 'card')}}
                >
                  <card.component />
                </CardContainer>
              </li>
            {{/each}}
          </:response>
        </PrerenderedCardSearch>
      {{/let}}
    </ul>
    <style scoped>
      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, var(--grid-card-width));
        grid-auto-rows: var(--grid-card-height);
        gap: var(--boxel-sp);
        list-style-type: none;
        margin: 0;
        padding: var(--boxel-sp-6xs) var(--boxel-sp-xl) var(--boxel-sp-6xs)
          var(--boxel-sp-6xs);
        overflow: auto;
      }
      .card-view {
        --grid-card-width: 1fr;
        --grid-card-height: 300px;
      }
      .strip-view {
        --grid-card-width: 300px;
        --grid-card-height: 115px;
      }
      .grid-view {
        --grid-card-width: 164px;
        --grid-card-height: 224px;
      }
      .card {
        max-width: 1440px;
      }
      .card-view-container {
        display: grid;
        grid-template-columns: 1fr 200px;
        gap: var(--boxel-sp-lg);
        padding: 10px;
      }
      .card {
        container-name: fitted-card;
        container-type: size;
      }
      .card-view-container :deep(article) {
        border-radius: var(--boxel-border-radius);
        box-shadow: inset 0 0 0 1px var(--boxel-light-500);
      }
    </style>
  </template>
}
