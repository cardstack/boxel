import GlimmerComponent from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { TrackedSet, TrackedMap } from 'tracked-built-ins';
import { tracked } from '@glimmer/tracking';
import { and } from '@cardstack/boxel-ui/helpers';

import {
  type CardContext,
  type BaseDef,
  type CardDef,
} from 'https://cardstack.com/base/card-api';

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
  @tracked cardResources: TrackedMap<string, CardDef>;

  constructor(owner: unknown, args: CardsGridSignature['Args']) {
    super(owner, args);
    this.cardResources = new TrackedMap<string, CardDef>();
  }

  @action
  async hydrateCard(card: PrerenderedCard) {
    if (!card?.url) {
      throw new Error('Card URL is required');
      return;
    }

    if (!this.cardResources.has(card.url)) {
      const cardId = removeFileExtension(card.url);
      const result = await this.args.context?.getCard(this, () => cardId);

      if (!result) {
        return;
      }
      this.cardResources.set(card.url, result);
    }
  }

  get isHydrated() {
    return (cardUrl: string) => {
      return (
        this.cardResources.has(cardUrl) &&
        this.cardResources.get(cardUrl)?.card != null
      );
    };
  }

  @action
  getCardComponent(cardUrl: string) {
    const resource = this.cardResources.get(cardUrl);
    return resource?.card ? getComponent(resource.card) : null;
  }

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
                {{#if (this.isHydrated card.url)}}
                  {{#let (this.getCardComponent card.url) as |Component|}}
                    <CardContainer
                      class='card'
                      {{@context.cardComponentModifier
                        cardId=card.url
                        format='data'
                        fieldType=undefined
                        fieldName=undefined
                      }}
                      data-test-cards-grid-item={{removeFileExtension card.url}}
                      data-cards-grid-item={{removeFileExtension card.url}}
                    >
                      <Component />
                    </CardContainer>
                  {{/let}}
                {{else}}
                  <CardContainer
                    class='card'
                    @displayBoundaries={{true}}
                    data-test-cards-grid-item={{removeFileExtension card.url}}
                    data-cards-grid-item={{removeFileExtension card.url}}
                    {{on 'mouseenter' (fn this.hydrateCard card)}}
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
