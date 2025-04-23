import GlimmerComponent from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';

import {
  type CardContext,
  type BaseDef,
} from 'https://cardstack.com/base/card-api';
import { and } from '@cardstack/boxel-ui/helpers';

import { type Query, type PrerenderedCard } from '@cardstack/runtime-common';

import { CardContainer } from '@cardstack/boxel-ui/components';

interface CardsGridSignature {
  Args: {
    query: Query;
    realms: URL[];
    selectedView: string;
    context?: CardContext;
  };
  Element: HTMLElement;
}

export class CardsGrid extends GlimmerComponent<CardsGridSignature> {
  @tracked hydratedCardId: string | undefined;
  cardResource = this.args.context?.getCard(this, () => this.hydratedCardId);

  @action
  async hydrateCard(card: PrerenderedCard | undefined) {
    if (!card) {
      this.hydratedCardId = undefined;
      return;
    }
    const cardId = removeFileExtension(card.url);
    this.hydratedCardId = cardId;
  }

  isHydrated = (cardUrl: string) => {
    return removeFileExtension(cardUrl) == this.hydratedCardId;
  };

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
        >
          <:loading>
            Loading...
          </:loading>
          <:response as |cards|>
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
                        {{@context.cardComponentModifier
                          cardId=card.url
                          format='data'
                          fieldType=undefined
                          fieldName=undefined
                        }}
                        data-test-cards-grid-item={{removeFileExtension
                          card.url
                        }}
                        data-cards-grid-item={{removeFileExtension card.url}}
                      >
                        <Component />
                      </CardContainer>
                    {{/let}}
                  {{/if}}
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

      .cards :deep(.field-component-card.fitted-format) {
        height: 100%;
      }
    </style>
  </template>
}

function getComponent(cardOrField: BaseDef) {
  return cardOrField.constructor.getComponent(cardOrField);
}

function removeFileExtension(cardUrl: string) {
  return cardUrl.replace(/\.[^/.]+$/, '');
}
