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
  handleBackdropClick(event: MouseEvent) {
    // Only handle clicks directly on the inner div or backdrop, not on children
    const target = event.target as HTMLElement;
    if (
      !target.classList.contains('inner') &&
      !target.classList.contains('backdrop-overlay') &&
      !target.closest('.backdrop-overlay')
    ) {
      return;
    }

    // Close the top card (last in array)
    if (this.args.close && this.args.stackItemCardIds.length > 0) {
      const topCardId =
        this.args.stackItemCardIds[this.args.stackItemCardIds.length - 1];
      this.args.close(topCardId);
    }
  }

  <template>
    <div class='host-mode-stack' ...attributes>
      {{! Backdrop button for closing top card }}
      <button
        type='button'
        class='backdrop-overlay'
        {{on 'click' this.handleBackdropClick}}
        aria-label='Close top card'
        data-test-host-mode-stack-backdrop
      >
        <span class='boxel-sr-only'>Close top card</span>
      </button>

      <div class='inner' tabindex='-1' {{on 'click' this.handleBackdropClick}}>
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

      .backdrop-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        padding: 0;
        margin: 0;
        border: none;
        background: transparent;
        cursor: default;
        z-index: 0;
      }

      .backdrop-overlay:focus {
        outline: none;
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
          min-height: 80cqh;
        }
      }

      @media print {
        .backdrop-overlay {
          display: none;
        }
      }
    </style>
  </template>
}
