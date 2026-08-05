import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import HostModeStackItem from './stack-item';

interface Signature {
  Element: HTMLElement;
  Args: {
    stackItemCardIds: string[];
    close?: (cardId: string) => void;
  };
}

export default class HostModeStack extends Component<Signature> {
  @action
  closeTopCard() {
    if (this.args.close && this.args.stackItemCardIds.length > 0) {
      const topCardId =
        this.args.stackItemCardIds[this.args.stackItemCardIds.length - 1];
      this.args.close(topCardId);
    }
  }

  // Dismiss belongs to the scrim alone: a document-wide click-outside also
  // fires for the click that navigated the stack, closing the card it just
  // opened. Tests for a click inside a card rather than target ===
  // currentTarget, since `.inner` fills the scrim and takes background clicks.
  @action
  onScrimClick(event: Event) {
    let target = event.target;
    if (
      target instanceof Element &&
      target.closest('[data-host-mode-stack-item]') !== null
    ) {
      return;
    }
    this.closeTopCard();
  }

  <template>
    {{! The scrim is a shortcut for the top card's close button, not the only
    way out, so it stays a plain element rather than gaining a button role. }}
    {{! template-lint-disable no-invalid-interactive }}
    <div
      class='host-mode-stack'
      {{on 'click' this.onScrimClick}}
      data-test-host-mode-stack
      ...attributes
    >
      <div class='inner' tabindex='-1'>
        <div class='stack-items' data-test-host-mode-stack-items>
          {{#each @stackItemCardIds key='cardId' as |cardId index|}}
            <HostModeStackItem
              @cardId={{cardId}}
              @index={{index}}
              @stackItemCardIds={{@stackItemCardIds}}
              @close={{@close}}
            />
          {{/each}}
        </div>
      </div>
    </div>

    <style scoped>
      .host-mode-stack {
        z-index: 1;
        height: 100%;
        width: 100%;
        background-color: rgba(0, 0, 0, 0.35);
        background-position: center;
        background-size: cover;
        padding: 0;
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
      }

      .inner {
        height: 100%;
        position: relative;
        display: flex;
        justify-content: center;
        margin: 0 auto;
        border-bottom-left-radius: var(--boxel-border-radius);
        border-bottom-right-radius: var(--boxel-border-radius);
        z-index: 1;
      }

      @media screen {
        .inner {
          overflow: auto;
        }
        /* .inner will handle overflow in host mode stack */
        .host-mode-stack :deep(.host-mode-card, .card) {
          overflow: hidden;
        }
      }

      .stack-items {
        display: contents;
      }
    </style>
  </template>
}
