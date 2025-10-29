import GlimmerComponent from '@glimmer/component';

import { type CardContext } from 'https://cardstack.com/base/card-api';

import { type Query } from '@cardstack/runtime-common';

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
  <template>
    <ul
      class='cards {{@selectedView}}-view'
      data-test-cards-grid-cards
      ...attributes
    >
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
            Loading...
          </:loading>
          <:response as |cards|>
            {{#each cards key='url' as |card|}}
              <li class='{{@selectedView}}-view-container'>
                <card.component
                  class='card'
                />
              </li>
            {{/each}}
          </:response>
        </PrerenderedCardSearch>
      {{/let}}
    </ul>
    <style scoped>
      .cards {
        --default-grid-view-min-width: 224px;
        --default-grid-view-max-width: 1fr;
        --default-grid-view-height: 360px;
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

      .card {
        container-name: fitted-card;
        container-type: size;
      }
    </style>
  </template>
}
