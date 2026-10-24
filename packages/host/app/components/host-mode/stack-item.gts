import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type { SafeString } from '@ember/template';
import { htmlSafe } from '@ember/template';

import { isTesting } from '@embroider/macros';

import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import { ContextButton } from '@cardstack/boxel-ui/components';
import { and, bool } from '@cardstack/boxel-ui/helpers';

import { getCard } from '@cardstack/host/resources/card-resource';

import HostModeCard from './card';

interface Signature {
  Element: HTMLElement;
  Args: {
    cardId: string;
    index: number;
    stackItemCardIds: string[];
    isNarrow?: boolean;
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
      ? 'calc(100% - var(--boxel-sp-2xl) * 2)'
      : `${stackItemMaxWidth / Math.pow(RATIO, invertedIndex)}rem`;

    // Width and offset go through custom properties so the phone-width rule
    // below can override them without !important.
    let styles = `
      height: calc(100% - ${marginTopPx}px);
      --host-stack-item-width: ${width};
      --host-stack-item-max-width: ${maxWidthPercent}%;
      --host-stack-item-margin-top: ${marginTopPx}px;
      z-index: calc(${this.args.index} + 1);
    `; // using margin-top instead of padding-top to hide scrolled content from view

    if (this.isTopCard) {
      styles += `height: auto;`;
    }

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
        {{if @isNarrow "narrow"}}
        {{if this.isTesting "testing"}}'
      style={{this.styleForStackedCard}}
      data-host-mode-stack-item
      data-test-host-mode-stack-item-index={{@index}}
      data-test-host-mode-stack-item={{@cardId}}
    >
      <div class='stack-item-card'>
        <HostModeCard
          @cardId={{@cardId}}
          @displayBoundaries={{if this.isItemFullWidth false true}}
          class='host-mode-stack-item-card'
        />
        {{#if (and this.isTopCard (bool @close))}}
          <div class='close-button-container'>
            <ContextButton
              @icon='close'
              @label='close'
              @variant='primary-dark'
              {{on 'click' this.handleClose}}
              data-test-host-stack-item-close-button
            />
          </div>
        {{/if}}
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
        width: var(--host-stack-item-width);
        max-width: var(--host-stack-item-max-width);
        height: inherit;
        margin-top: var(--host-stack-item-margin-top);
        padding-top: var(--boxel-sp-2xl);
        z-index: 0;
        pointer-events: none;
        /* The top card is content-sized (height: auto, see
           styleForStackedCard) with an 80cqh floor so the page scrolls as a
           page. But a percentage height never resolves against min-height, so
           an isolated template that fills its container (height: 100%,
           container-type: size, cqh units) had nothing to fill and collapsed
           to its padding. A grid area IS definite for its item even when the
           grid's own height is auto: the single 1fr row hands the card the
           floor when content is short and still grows when it is tall. */
        display: grid;
        grid-template-rows: minmax(0, 1fr);
      }

      .host-mode-stack-item:not(.buried) {
        /* Keeps a gutter while the viewport is narrower than the 50rem card,
           the same one the narrow layout uses. */
        max-width: min(
          var(--host-stack-item-max-width),
          calc(100% - var(--boxel-sp-xs) * 2)
        );
        padding-bottom: var(--boxel-sp-2xl);
        /* The top card fills its item; otherwise it keeps its 50rem default
           and is clipped when the item is narrower. */
        --host-mode-card-width: 100%;
      }

      /* Buried cards stay 50rem, even behind a wide primary card that sets
         100%, so they don't reflow every time the stack changes. */
      .host-mode-stack-item.buried {
        --host-mode-card-width: 50rem;
      }

      .host-mode-stack-item.full-width {
        max-width: 100%;
      }

      /* When host mode is narrow, only the top card shows, wide-format or
         not, with a small gutter. */
      .host-mode-stack-item.narrow:not(.buried) {
        width: calc(100% - var(--boxel-sp-xs) * 2);
        margin-top: 0;
        padding-block: var(--boxel-sp-xs);
      }

      .host-mode-stack-item.narrow.buried {
        display: none;
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

      /* reduced motion: a card fades in and out where it stands, and the
         cards under it keep their places rather than sliding */
      @keyframes stackItemFadeIn {
        from {
          opacity: 0;
        }
      }

      @keyframes stackItemFadeOut {
        to {
          opacity: 0;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .host-mode-stack-item {
          transition: none;
        }

        .host-mode-stack-item.opening-animation {
          animation-name: stackItemFadeIn;
          transition: none;
        }

        .host-mode-stack-item.closing-animation {
          animation-name: stackItemFadeOut;
        }

        .host-mode-stack-item.move-forward-animation {
          animation: none;
        }
      }

      .host-mode-stack-item.buried {
        --realm-icon-border-radius: 4px;
      }

      .stack-item-card {
        height: 100%;
        border-radius: var(--boxel-border-radius-2xl);
        box-shadow: var(--boxel-deep-box-shadow);
        pointer-events: auto;
        overflow: hidden;
        background-color: var(--boxel-light);
        display: flex;
        flex-direction: column;
        position: relative;
      }

      .host-mode-stack-item.buried > .stack-item-card {
        border-radius: var(--boxel-border-radius-lg);
        background-color: var(--boxel-200);
      }

      .close-button-container {
        position: absolute;
        top: var(--boxel-sp-xs);
        right: var(--boxel-sp-xs);
        z-index: 1;
      }
      .close-button-container :deep(.boxel-context-button) {
        box-shadow: var(--boxel-box-shadow);
      }
      .close-button-container :deep(.boxel-context-button:hover) {
        box-shadow: var(--boxel-box-shadow-hover);
      }

      .host-mode-stack-item-card {
        border-radius: inherit;
        box-shadow: none;
        z-index: 0;
      }
      .host-mode-stack-item-card > :deep(.boxel-card-container) {
        border-radius: inherit;
      }

      @media print {
        .host-mode-stack-item {
          height: 100% !important;
        }
        .host-mode-stack-item-card {
          height: 100%;
          overflow: auto;
        }
        .close-button-container {
          display: none;
        }
      }
    </style>
  </template>
}
