import GlimmerComponent from '@glimmer/component';
import { type CardContext } from 'https://cardstack.com/base/card-api';
import { eq } from '@cardstack/boxel-ui/helpers';

import { type Query } from '@cardstack/runtime-common';

import { CardContainer } from '@cardstack/boxel-ui/components';
import ListingFittedSkeleton from './listing-fitted-skeleton';
import { CardWithHydration } from './card-with-hydration';

interface CardsGridSignature {
  Args: {
    query: Query;
    realms: string[];
    selectedView: string;
    context?: CardContext;
  };
  Element: HTMLElement;
}

export class CardsGrid extends GlimmerComponent<CardsGridSignature> {
  //default to rendering 10 skeletons
  get renderSkeletons() {
    return Array.from({ length: 10 }, (_, i) => i);
  }

  <template>
    {{#let
      (component @context.prerenderedCardSearchComponent)
      as |PrerenderedCardSearch|
    }}
      <PrerenderedCardSearch
        @query={{@query}}
        @format='fitted'
        @realms={{@realms}}
        @isLive={{true}}
      >
        <:loading>
          <ul class='cards {{@selectedView}}-view' ...attributes>
            {{#each this.renderSkeletons}}
              <li class='{{@selectedView}}-view-container'>
                <CardContainer class='card' @displayBoundaries={{true}}>
                  <ListingFittedSkeleton />
                </CardContainer>
              </li>
            {{/each}}
          </ul>
        </:loading>
        <:response as |cards|>
          {{#if (eq cards.length 0)}}
            <p class='no-results' data-test-no-results>No results found</p>
          {{else}}
            <ul
              class='cards {{@selectedView}}-view'
              data-test-cards-grid-cards
              ...attributes
            >
              {{#each cards key='url' as |card|}}
                <li
                  class='{{@selectedView}}-view-container'
                  data-test-card-url={{card.url}}
                >
                  <CardWithHydration @card={{card}} @context={{@context}} />
                </li>
              {{/each}}
            </ul>
          {{/if}}
        </:response>
      </PrerenderedCardSearch>
    {{/let}}

    <style scoped>
      .cards {
        --default-grid-view-min-width: 224px;
        --default-grid-view-max-width: 1fr;
        --default-grid-view-height: 400px;
        --default-strip-view-min-width: 49%;
        --default-strip-view-max-width: 1fr;
        --default-strip-view-height: 180px;

        display: grid;
        gap: var(--boxel-sp);
        list-style-type: none;
        margin: 0;
        padding: var(--boxel-sp-6xs);
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

      .cards li {
        cursor: pointer;
      }

      .cards :deep(.field-component-card.fitted-format) {
        height: 100%;
      }

      .no-results {
        font: 600 var(--boxel-font-lg);
        text-align: left;
        padding: var(--boxel-sp-6xs);
      }
    </style>
  </template>
}
