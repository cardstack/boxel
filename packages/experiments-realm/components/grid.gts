import GlimmerComponent from '@glimmer/component';

import { Format, type CardContext } from 'https://cardstack.com/base/card-api';

import { type Query } from '@cardstack/runtime-common';

import { CardContainer } from '@cardstack/boxel-ui/components';
import { eq, not } from '@cardstack/boxel-ui/helpers';

export type ViewOption = 'card' | 'strip' | 'grid';

interface PrerenderedCard {
  url: string;
  component: any;
}

interface CardsGridSignature {
  Args: {
    query: Query;
    realms: URL[];
    selectedView: ViewOption;
    context?: CardContext;
    format: Format;
  };
  Blocks: {
    meta: [card: PrerenderedCard];
  };
  Element: HTMLElement;
}
export class CardsGrid extends GlimmerComponent<CardsGridSignature> {
  <template>
    <ul class='cards {{@selectedView}}-view' data-test-cards-grid-cards>
      {{#let
        (component @context.prerenderedCardSearchComponent)
        as |PrerenderedCardSearch|
      }}
        <PrerenderedCardSearch
          @query={{@query}}
          @format={{@format}}
          @realms={{@realms}}
        >
          <:loading>
            Loading...
          </:loading>
          <:response as |cards|>
            {{#each cards key='url' as |card|}}
              <li class='{{@selectedView}}-view-container'>
                <CardContainer
                  {{@context.cardComponentModifier
                    cardId=card.url
                    format='data'
                    fieldType=undefined
                    fieldName=undefined
                  }}
                  class='card'
                  @displayBoundaries={{not (eq @selectedView 'card')}}
                >
                  <card.component />
                </CardContainer>
                {{#if (eq @selectedView 'card')}}
                  {{#if (has-block 'meta')}}
                    {{yield card to='meta'}}
                  {{/if}}
                {{/if}}
              </li>
            {{/each}}
          </:response>
        </PrerenderedCardSearch>
      {{/let}}
    </ul>
    <style scoped>
      .cards {
        --default-card-view-min-width: 750px;
        --default-card-view-max-width: 1fr;
        --default-card-view-height: 347px;
        --default-grid-view-min-width: 224px;
        --default-grid-view-max-width: 1fr;
        --default-grid-view-height: max-content;
        --default-strip-view-min-width: 49%;
        --default-strip-view-max-width: 1fr;
        --default-strip-view-height: 180px;

        display: grid;
        grid-template-columns: repeat(
          auto-fill,
          minmax(
            var(--card-view-min-width, var(--default-card-view-min-width)),
            var(--card-view-max-width, var(--default-card-view-max-width))
          )
        );
        grid-auto-rows: var(
          --card-view-height,
          var(--default-card-view-height)
        );
        gap: var(--boxel-sp);
        list-style-type: none;
        margin: 0;
        padding: var(--boxel-sp-6xs);
      }

      .cards.card-view {
        grid-template-columns: repeat(
          auto-fill,
          minmax(
            var(--card-view-min-width, var(--default-card-view-min-width)),
            var(--card-view-max-width, var(--default-card-view-max-width))
          )
        );
        grid-auto-rows: var(
          --card-view-height,
          var(--default-card-view-height)
        );
      }

      .cards.strip-view {
        grid-template-columns: repeat(
          auto-fill,
          minmax(
            var(--strip-view-min-width, var(--default-strip-view-min-width)),
            var(--strip-view-max-width, var(--default-strip-view-max-width))
          )
        );
        grid-auto-rows: var(
          --strip-view-height,
          var(--default-strip-view-height)
        );
      }

      .cards.grid-view {
        grid-template-columns: repeat(
          auto-fill,
          minmax(
            var(--grid-view-min-width, var(--default-grid-view-min-width)),
            var(--grid-view-max-width, var(--default-grid-view-max-width))
          )
        );
        grid-auto-rows: var(
          --grid-view-height,
          var(--default-grid-view-height)
        );
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
