import GlimmerComponent from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';

import {
  type CardContext,
  type BaseDef,
} from 'https://cardstack.com/base/card-api';
import { and, eq } from '@cardstack/boxel-ui/helpers';

import {
  type PrerenderedCardLike,
  type Query,
} from '@cardstack/runtime-common';

import { CardContainer } from '@cardstack/boxel-ui/components';
import ListingFittedSkeleton from './listing-fitted-skeleton';

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
  @tracked hydratedCardId: string | undefined;
  cardResource = this.args.context?.getCard(this, () => this.hydratedCardId);

  @action
  async hydrateCard(card: PrerenderedCardLike | undefined) {
    if (!card) {
      this.hydratedCardId = undefined;
      return;
    }
    const cardId = removeFileExtension(card.url);
    this.hydratedCardId = cardId;
  }

  //default to rendering 10 skeletons
  get renderSkeletons() {
    return Array.from({ length: 10 }, (_, i) => i);
  }

  isHydrated = (cardUrl: string) => {
    return removeFileExtension(cardUrl) == this.hydratedCardId;
  };

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
                  {{#if
                    (and (this.isHydrated card.url) this.cardResource.isLoaded)
                  }}
                    {{#if this.cardResource.card}}
                      {{#let
                        (getComponent this.cardResource.card)
                        as |Component|
                      }}
                        <CardContainer
                          class='card'
                          @displayBoundaries={{true}}
                          data-test-cards-grid-item={{removeFileExtension
                            card.url
                          }}
                          data-cards-grid-item={{removeFileExtension card.url}}
                        >
                          <Component />
                        </CardContainer>
                      {{/let}}
                    {{/if}}
                  {{else if card.isError}}
                    <CardContainer
                      class='card instance-error'
                      @displayBoundaries={{true}}
                      data-test-instance-error={{card.isError}}
                      data-test-cards-grid-item={{removeFileExtension card.url}}
                      data-cards-grid-item={{removeFileExtension card.url}}
                    >
                      <card.component />
                    </CardContainer>
                  {{else}}
                    <CardContainer
                      class='card'
                      @displayBoundaries={{true}}
                      data-test-cards-grid-item={{removeFileExtension card.url}}
                      data-cards-grid-item={{removeFileExtension card.url}}
                      {{on 'mouseenter' (fn this.hydrateCard card)}}
                      {{on 'mouseleave' (fn this.hydrateCard undefined)}}
                    >
                      <card.component />
                    </CardContainer>
                  {{/if}}
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

      .cards li {
        cursor: pointer;
      }

      .card {
        container-name: fitted-card;
        container-type: size;
        transition: ease 0.2s;
      }

      .card:hover {
        cursor: pointer;
        border: 1px solid var(--boxel-purple);
      }

      .cards :deep(.field-component-card.fitted-format) {
        height: 100%;
      }

      .no-results {
        font: 600 var(--boxel-font-lg);
        text-align: left;
        padding: var(--boxel-sp-6xs);
      }
      .instance-error {
        --instance-error-z-index: 1;
        position: relative;
      }
      .instance-error::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        z-index: var(--instance-error-z-index);
        width: 100%;
        height: 100%;
        background-color: rgba(255, 0, 0, 0.1);
      }
      .instance-error:hover {
        border: none;
        transform: none;
      }
      .instance-error.boundaries {
        box-shadow: 0 0 0 1px var(--boxel-error-300);
      }
      .instance-error.boundaries:hover {
        box-shadow: 0 0 0 1px var(--boxel-dark);
      }
    </style>
  </template>
}

function getComponent(cardOrField: BaseDef) {
  return cardOrField.constructor.getComponent(cardOrField);
}

function removeFileExtension(cardUrl: string) {
  return cardUrl?.replace(/\.[^/.]+$/, '');
}
