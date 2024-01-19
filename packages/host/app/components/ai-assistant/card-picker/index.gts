import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import { AddButton, IconButton } from '@cardstack/boxel-ui/components';
import { IconX } from '@cardstack/boxel-ui/icons';

import Pill from '@cardstack/host/components/pill';

import { type CardDef } from 'https://cardstack.com/base/card-api';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    card: CardDef | undefined;
    chooseCard: () => void;
    removeCard: () => void;
    isLoading?: boolean;
  };
  Blocks: { default: [] };
}

export default class AiAssistantCardPicker extends Component<Signature> {
  <template>
    <div class='card-picker'>
      {{#if @card}}
        <Pill
          @inert={{true}}
          class='selected-card'
          data-test-selected-card={{@card.id}}
        >
          <this.cardComponent />
          <IconButton
            class='remove-button'
            @icon={{IconX}}
            {{on 'click' @removeCard}}
            data-test-remove-card-btn
          />
        </Pill>
      {{else}}
        <AddButton
          class='attach-button'
          @variant='pill'
          {{on 'click' @chooseCard}}
          @disabled={{@isLoading}}
          data-test-choose-card-btn
        >
          Attach Card
        </AddButton>
      {{/if}}

      {{yield}}
    </div>
    <style>
      .card-picker {
        --pill-height: 1.875rem;
        background-color: var(--boxel-100);
        color: var(--boxel-dark);
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxs);
        padding: var(--boxel-sp);
      }
      .attach-button {
        --boxel-form-control-border-radius: var(--boxel-border-radius-sm);
        --boxel-add-button-pill-font: var(--boxel-font-sm);
        height: var(--pill-height);
        padding: 0 var(--boxel-sp-xs);
      }
      .attach-button:hover:not(:disabled) {
        box-shadow: none;
        background-color: var(--boxel-highlight-hover);
      }
      .selected-card {
        height: var(--pill-height);
        background-color: var(--boxel-light);
        border: 1px solid var(--boxel-400);
      }
      .selected-card :deep(.atom-format) {
        background: none;
        box-shadow: none;
        border: none;
        padding: 0;
      }
      .remove-button {
        --boxel-icon-button-width: 25px;
        --boxel-icon-button-height: 25px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .remove-button:hover:not(:disabled) {
        --icon-color: var(--boxel-highlight);
      }
    </style>
  </template>

  private get cardComponent() {
    let card = this.args.card;
    if (card) {
      return card.constructor.getComponent(card, 'atom');
    }
    return undefined;
  }
}
