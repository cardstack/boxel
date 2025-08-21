import GlimmerComponent from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';

import {
  type CardContext,
  type BaseDef,
} from 'https://cardstack.com/base/card-api';

import { type PrerenderedCardLike } from '@cardstack/runtime-common';

import { CardContainer } from '@cardstack/boxel-ui/components';

interface CardWithHydrationSignature {
  Args: {
    card: PrerenderedCardLike;
    context?: CardContext;
  };
  Element: HTMLElement;
}

export class CardWithHydration extends GlimmerComponent<CardWithHydrationSignature> {
  @tracked hydratedCardId: string | undefined;
  @action
  async hydrateCard(card: PrerenderedCardLike) {
    if (this.hydratedCardId == card.url) {
      return;
    }
    const cardId = removeFileExtension(card.url);
    this.hydratedCardId = cardId;
  }
  get isHydrated() {
    return new Boolean(this.hydratedCardId) && this.cardResource?.isLoaded;
  }
  cardResource = this.args.context?.getCard(this, () => this.hydratedCardId);
  <template>
    {{#if this.isHydrated}}
      {{#if this.cardResource.card}}
        {{#let (getComponent this.cardResource.card) as |Component|}}
          <CardContainer
            class='card'
            @displayBoundaries={{true}}
            data-test-cards-grid-item={{removeFileExtension @card.url}}
            data-cards-grid-item={{removeFileExtension @card.url}}
            data-test-hydrated-card
          >
            <Component />
          </CardContainer>
        {{/let}}
      {{/if}}
    {{else if @card.isError}}
      <CardContainer
        class='card instance-error'
        @displayBoundaries={{true}}
        data-test-instance-error={{@card.isError}}
        data-test-cards-grid-item={{removeFileExtension @card.url}}
        data-cards-grid-item={{removeFileExtension @card.url}}
      >
        <@card.component />
      </CardContainer>
    {{else}}
      <CardContainer
        class='card'
        @displayBoundaries={{true}}
        data-test-cards-grid-item={{removeFileExtension @card.url}}
        data-cards-grid-item={{removeFileExtension @card.url}}
        {{on 'mouseenter' (fn this.hydrateCard @card)}}
      >
        <@card.component />
      </CardContainer>
    {{/if}}

    <style scoped>
      .card {
        container-name: fitted-card;
        container-type: size;
        transition: ease 0.2s;
      }

      .card:hover {
        cursor: pointer;
        border: 1px solid var(--boxel-purple);
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
