import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { htmlSafe, SafeString } from '@ember/template';

import { isTesting } from '@embroider/macros';

import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import X from '@cardstack/boxel-icons/x';

import { IconButton } from '@cardstack/boxel-ui/components';

import { getCard } from '@cardstack/host/resources/card-resource';

import HostModeCard from './card';

interface Signature {
  Element: HTMLElement;
  Args: {
    cardId: string;
    index: number;
    stackItemCardIds: string[];
    close?: (cardId: string) => void;
  };
}

export default class HostModeStackItem extends Component<Signature> {
  @tracked private animationType:
    | 'opening'
    | 'closing'
    | 'movingForward'
    | undefined = 'opening';

  @cached
  private get cardResource(): ReturnType<typeof getCard> | undefined {
    if (!this.args.cardId) {
      return undefined;
    }
    return getCard(this, () => this.args.cardId);
  }

  @cached
  private get card() {
    return this.cardResource?.card;
  }

  private get styleForStackedCard(): SafeString {
    const stackItemMaxWidth = 50; // unit: rem, 800px for 16px base
    const RATIO = 1.2;
    //  top card: 800px / (1.2 ^ 0) = 800px;
    //  buried card: 800px / (1.2 ^ 1) = ~666px;
    //  next buried card: 800px / (1.2 ^ 2) = ~555px;
    const maxWidthReductionPercent = 10; // Every new card on the stack is 10% wider than the previous one (for narrow viewport)
    const numberOfCards = this.args.stackItemCardIds.length;
    const invertedIndex = numberOfCards - this.args.index - 1;
    const isLastCard = this.args.index === numberOfCards - 1;
    const isSecondLastCard = this.args.index === numberOfCards - 2;

    let marginTopPx = 0;

    if (invertedIndex > 2) {
      marginTopPx = -5; // If there are more than 3 cards, those cards are buried behind the header
    }

    if (numberOfCards > 1) {
      if (isLastCard) {
        marginTopPx = numberOfCards === 2 ? 30 : 50;
      } else if (isSecondLastCard && numberOfCards > 2) {
        marginTopPx = 25;
      }
    }

    let maxWidthPercent = 100 - invertedIndex * maxWidthReductionPercent;
    let width = this.isItemFullWidth
      ? '100%'
      : `${stackItemMaxWidth / Math.pow(RATIO, invertedIndex)}rem`;

    let styles = `
      height: calc(100% - ${marginTopPx}px);
      width: ${width};
      max-width: ${maxWidthPercent}%;
      z-index: calc(${this.args.index} + 1);
      margin-top: ${marginTopPx}px;
      transition: margin-top var(--boxel-transition), width var(--boxel-transition);
    `; // using margin-top instead of padding-top to hide scrolled content from view

    return htmlSafe(styles);
  }

  private get isBuried() {
    return this.args.index + 1 < this.args.stackItemCardIds.length;
  }

  private get isTopCard() {
    return !this.isBuried;
  }

  private get isItemFullWidth() {
    return !this.isBuried && this.isWideFormat;
  }

  private get isWideFormat() {
    if (!this.card) {
      return false;
    }
    let { constructor } = this.card;
    return Boolean(
      constructor &&
        'prefersWideFormat' in constructor &&
        constructor.prefersWideFormat,
    );
  }

  private get doOpeningAnimation() {
    return (
      this.isTopCard && this.animationType === 'opening' && !this.isTesting
    );
  }

  private get doClosingAnimation() {
    return this.animationType === 'closing';
  }

  private get doMovingForwardAnimation() {
    return this.animationType === 'movingForward';
  }

  private get isTesting() {
    return isTesting();
  }

  @action
  private handleClose() {
    if (this.args.close) {
      this.args.close(this.args.cardId);
    }
  }

  <template>
    <div
      class='host-mode-stack-item
        {{if this.isBuried "buried"}}
        {{if this.doOpeningAnimation "opening-animation"}}
        {{if this.doClosingAnimation "closing-animation"}}
        {{if this.doMovingForwardAnimation "move-forward-animation"}}
        {{if this.isItemFullWidth "full-width"}}
        {{if this.isTesting "testing"}}'
      data-test-host-mode-stack-item-index={{@index}}
      data-test-host-mode-stack-item={{@cardId}}
      style={{this.styleForStackedCard}}
    >
      <div class='stack-item-card'>
        {{#if @close}}
          <div class='close-button-container'>
            <IconButton
              class='close-button'
              @icon={{X}}
              @width='16px'
              @height='16px'
              {{on 'click' this.handleClose}}
            />
          </div>
        {{/if}}
        <HostModeCard
          @cardId={{@cardId}}
          @displayBoundaries={{if this.isItemFullWidth false true}}
          class='host-mode-stack-item-card'
        />
      </div>
    </div>

    <style scoped>
      @keyframes scaleIn {
        from {
          transform: scale(0.1);
          opacity: 0;
        }
        to {
          transform: scale(1);
          opacity: 1;
        }
      }

      @keyframes fadeOut {
        from {
          opacity: 1;
          transform: translateY(0);
        }
        to {
          opacity: 0;
          transform: translateY(100%);
        }
      }

      @keyframes moveForward {
        from {
          transform: translateY(0);
          opacity: 0.8;
        }
        to {
          transform: translateY(25px);
          opacity: 1;
        }
      }

      .host-mode-stack-item {
        justify-self: center;
        position: absolute;
        width: 89%;
        height: inherit;
        z-index: 0;
        pointer-events: none;
      }

      .host-mode-stack-item.full-width {
        width: 100%;
        max-width: 100%;
      }

      .host-mode-stack-item.opening-animation {
        animation: scaleIn 0.2s forwards;
        transition: margin-top var(--boxel-transition);
      }

      .host-mode-stack-item.closing-animation {
        animation: fadeOut 0.2s forwards;
      }

      .host-mode-stack-item.move-forward-animation {
        animation: moveForward 0.2s none;
      }

      .host-mode-stack-item.opening-animation.testing {
        animation-duration: 0s;
      }

      .host-mode-stack-item.closing-animation.testing {
        animation-duration: 0s;
      }

      .host-mode-stack-item.move-forward-animation.testing {
        animation-duration: 0s;
      }

      .host-mode-stack-item.buried {
        --realm-icon-border-radius: 4px;
      }

      .stack-item-card {
        height: 100%;
        border-radius: var(--boxel-border-radius-xl);
        box-shadow: var(--boxel-deep-box-shadow);
        pointer-events: auto;
        overflow: hidden;
        background-color: var(--boxel-light);
        display: flex;
        flex-direction: column;
      }

      .host-mode-stack-item.buried > .stack-item-card {
        border-radius: var(--boxel-border-radius-lg);
        background-color: var(--boxel-200);
      }

      .close-button-container {
        display: flex;
        justify-content: flex-end;
        padding: var(--boxel-sp-xs);
      }

      .close-button {
        height: 18px;
        width: 18px;
      }

      .host-mode-stack-item-card {
        border-radius: 0;
        box-shadow: none;
        overflow: auto;
        height: 100%;
      }
    </style>
  </template>
}
