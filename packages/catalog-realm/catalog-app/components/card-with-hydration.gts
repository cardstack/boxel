import GlimmerComponent from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';

import {
  type CardContext,
  type BaseDef,
  type BoxComponent,
} from 'https://cardstack.com/base/card-api';

import { type PrerenderedCardLike } from '@cardstack/runtime-common';

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
    return (
      new Boolean(this.hydratedCardId) &&
      this.cardResource?.isLoaded &&
      !this.cardResource?.cardError //defensive guard
    );
  }
  cardResource = this.args.context?.getCard(this, () => this.hydratedCardId);
  <template>
    {{#if this.isHydrated}}
      {{#if this.cardResource.card}}
        {{#let (getComponent this.cardResource.card) as |Component|}}
          {{#if Component}}
            <Component
              class='card'
              data-test-cards-grid-item={{removeFileExtension @card.url}}
              data-cards-grid-item={{removeFileExtension @card.url}}
              data-test-hydrated-card
            />
          {{/if}}
        {{/let}}
      {{/if}}
    {{else if @card.isError}}
      <@card.component
        class='card instance-error'
        data-test-instance-error={{@card.isError}}
        data-test-cards-grid-item={{removeFileExtension @card.url}}
        data-cards-grid-item={{removeFileExtension @card.url}}
      />
    {{else}}
      <@card.component
        class='card'
        data-test-cards-grid-item={{removeFileExtension @card.url}}
        data-cards-grid-item={{removeFileExtension @card.url}}
        {{on 'mouseenter' (fn this.hydrateCard @card)}}
      />
    {{/if}}

    <style scoped>
      .card {
        container-name: fitted-card;
        container-type: size;
        transition: ease 0.2s;
      }

      .card:hover {
        cursor: pointer;
        outline: 1px solid var(--boxel-purple);
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
      .instance-error.boundaries {
        box-shadow: 0 0 0 1px var(--boxel-error-300);
      }
      .instance-error.boundaries:hover {
        box-shadow: 0 0 0 1px var(--boxel-dark);
      }
    </style>
  </template>
}

function getComponent(cardOrField: BaseDef | undefined | null): BoxComponent | undefined {
  if (!cardOrField) {
    return;
  }
  let constructor = cardOrField.constructor as typeof BaseDef | undefined;
  if (typeof constructor?.getComponent !== 'function') {
    return;
  }
  return constructor.getComponent(cardOrField);
}

function removeFileExtension(cardUrl: string | undefined | null) {
  if (typeof cardUrl !== 'string') {
    return '';
  }
  return cardUrl.replace(/\.[^/.]+$/, '');
}
