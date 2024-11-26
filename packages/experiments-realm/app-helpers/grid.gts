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
                class='{{@selectedView}}-view-container'
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
        grid-template-columns: repeat(
          auto-fill,
          minmax(var(--grid-card-min-width), var(--grid-card-max-width))
        );
        grid-auto-rows: var(--grid-card-height);
        gap: var(--boxel-sp);
        list-style-type: none;
        margin: 0;
        padding: var(--boxel-sp-6xs);
      }
      .card-view {
        --grid-card-height: 347px;
        grid-template-columns: minmax(750px, 1fr);
      }
      .strip-view {
        --grid-card-min-width: 49%;
        --grid-card-max-width: 1fr;
        --grid-card-height: 180px;
      }
      .grid-view {
        --grid-card-min-width: 224px;
        --grid-card-max-width: 1fr;
        --grid-card-height: max-content;
      }
      .grid-view-container {
        aspect-ratio: 5/6;
      }
      .card-view-container {
        display: grid;
        grid-template-columns: 1fr 247px;
        gap: var(--boxel-sp-lg);
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
