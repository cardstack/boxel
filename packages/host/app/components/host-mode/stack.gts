import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { cancel, later } from '@ember/runloop';
import Component from '@glimmer/component';

import { modifier } from 'ember-modifier';

import {
  focusIfConnected,
  focusStackItem,
  isTextEntry,
} from '@cardstack/host/utils/stack-item-focus';

import HostModeStackItem from './stack-item';

interface Signature {
  Element: HTMLElement;
  Args: {
    stackItemCardIds: string[];
    isNarrow?: boolean;
    close?: (cardId: string) => void;
  };
}

export default class HostModeStack extends Component<Signature> {
  // What had focus as each card opened, by stack position: closing a card
  // hands focus back to whatever opened it.
  private openers: (Element | null)[] = [];
  private stackElement: HTMLElement | undefined;

  private get topItem(): HTMLElement | undefined {
    let items = this.stackElement?.querySelectorAll<HTMLElement>(
      '[data-host-mode-stack-item]',
    );
    return items?.[items.length - 1];
  }

  private focusTopItem() {
    let item = this.topItem;
    if (item) {
      focusStackItem(item);
    }
  }

  // A card that opens takes focus, so the keyboard and a screen reader carry
  // on in the card that is now on top rather than in the page under the
  // scrim. A card that closes gives focus back to what opened it.
  private followStack = modifier(
    (element: HTMLElement, [cardIds]: [string[]]) => {
      this.stackElement = element;
      let count = cardIds.length;
      if (count > this.openers.length) {
        let active = document.activeElement;
        let opener = active && active !== document.body ? active : null;
        while (this.openers.length < count) {
          this.openers.push(opener);
        }
        this.focusTopItem();
      } else if (count < this.openers.length) {
        let opener = this.openers[count];
        this.openers.length = count;
        if (!focusIfConnected(opener)) {
          this.focusTopItem();
        }
      }
    },
  );

  @action
  onKeydown(event: Event) {
    if (
      !(event instanceof KeyboardEvent) ||
      event.key !== 'Escape' ||
      event.defaultPrevented ||
      isTextEntry(event.target)
    ) {
      return;
    }
    event.preventDefault();
    this.closeTopCard();
  }

  private previousCardIds: string[] = [];
  // Indexed by stack depth, not card id: the URL can put the same card in
  // the trail twice, and each copy keeps its own place.
  private savedScrollTops: number[] = [];
  // Read from scroll events rather than at push time: by then the old top
  // card has shrunk to its buried height and the offset is already clamped.
  private lastScrollTop = 0;
  // Kept on the instance: the modifier reads the tracked ids, so every push
  // and pop re-runs it, and a teardown would cancel a restore in progress.
  private restoreTimer: ReturnType<typeof later> | undefined;
  private restoreTarget = 0;

  // Every stack item scrolls in the shared `.inner`, so its scrollTop would
  // carry over from card to card. A pushed card opens at its top, and closing
  // it returns the card underneath to where it was left.
  private manageScroll = modifier(
    (element: HTMLElement, [cardIds]: [string[]]) => {
      let onScroll = () => {
        this.lastScrollTop = element.scrollTop;
      };
      // Any scroll the user starts wins over a restore still being applied.
      let onUserInput = () => this.cancelRestore();
      let userInputEvents = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
      element.addEventListener('scroll', onScroll, { passive: true });
      for (let type of userInputEvents) {
        element.addEventListener(type, onUserInput, { passive: true });
      }

      let previous = this.previousCardIds;
      let shared = 0;
      while (
        shared < previous.length &&
        shared < cardIds.length &&
        previous[shared] === cardIds[shared]
      ) {
        shared++;
      }
      let pushed =
        cardIds.length > previous.length && shared === previous.length;
      let popped =
        cardIds.length < previous.length && shared === cardIds.length;

      if (pushed) {
        // A restore still in progress has only reached part of the way; the
        // card's real position is where it was heading.
        let offset =
          this.restoreTimer === undefined
            ? this.lastScrollTop
            : this.restoreTarget;
        this.cancelRestore();
        if (previous.length > 0) {
          this.savedScrollTops[previous.length - 1] = offset;
        }
        this.setScrollTop(element, 0);
      } else if (popped) {
        this.cancelRestore();
        this.restoreScrollTop(
          element,
          this.savedScrollTops[cardIds.length - 1] ?? 0,
        );
      } else if (shared < cardIds.length) {
        this.cancelRestore();
        this.setScrollTop(element, 0);
      }
      // Only cards below the top keep a saved offset, and only while the
      // trail beneath them is unchanged.
      this.savedScrollTops.length = Math.min(
        this.savedScrollTops.length,
        shared,
        Math.max(cardIds.length - 1, 0),
      );
      this.previousCardIds = [...cardIds];

      return () => {
        element.removeEventListener('scroll', onScroll);
        for (let type of userInputEvents) {
          element.removeEventListener(type, onUserInput);
        }
      };
    },
  );

  // Scroll events arrive a frame late, so an offset set here is recorded
  // directly; a push in the same tick then saves the right value.
  private setScrollTop(element: HTMLElement, scrollTop: number) {
    element.scrollTop = scrollTop;
    this.lastScrollTop = element.scrollTop;
  }

  // The card underneath grows back to its full height over a few frames, and
  // until it has, the offset is clamped short. Reapply it until it holds, or
  // until the content stops growing and the offset can't be reached.
  private restoreScrollTop(element: HTMLElement, scrollTop: number) {
    let attempts = 0;
    let unchangedAttempts = 0;
    let lastScrollHeight: number | undefined;
    this.restoreTarget = scrollTop;
    let restore = () => {
      this.setScrollTop(element, scrollTop);
      unchangedAttempts =
        element.scrollHeight === lastScrollHeight ? unchangedAttempts + 1 : 0;
      lastScrollHeight = element.scrollHeight;
      this.restoreTimer =
        element.scrollTop < scrollTop &&
        ++attempts < 30 &&
        unchangedAttempts < 5
          ? later(restore, 16)
          : undefined;
    };
    restore();
  }

  private cancelRestore() {
    if (this.restoreTimer !== undefined) {
      cancel(this.restoreTimer);
      this.restoreTimer = undefined;
    }
  }

  willDestroy() {
    super.willDestroy();
    this.cancelRestore();
    // the last card has closed and the stack goes with it
    focusIfConnected(this.openers[0]);
  }

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
      {{on 'keydown' this.onKeydown}}
      {{this.followStack @stackItemCardIds}}
      data-test-host-mode-stack
      ...attributes
    >
      <div
        class='inner'
        tabindex='-1'
        {{this.manageScroll @stackItemCardIds}}
        data-test-host-mode-stack-scroller
      >
        <div class='stack-items' data-test-host-mode-stack-items>
          {{#each @stackItemCardIds key='cardId' as |cardId index|}}
            <HostModeStackItem
              @cardId={{cardId}}
              @index={{index}}
              @stackItemCardIds={{@stackItemCardIds}}
              @isNarrow={{@isNarrow}}
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
          overscroll-behavior: none;
        }
        /* .inner will handle overflow in host mode stack. The card's own
           overscroll-behavior: none would stop scrolls from reaching it. */
        .host-mode-stack :deep(.host-mode-card, .card) {
          overflow: hidden;
        }
        .host-mode-stack :deep(.host-mode-card),
        .host-mode-stack :deep(.host-mode-card > .card) {
          overscroll-behavior: auto;
        }
      }

      .stack-items {
        display: contents;
      }

      /* the top card takes focus from script as it opens, to carry the
         keyboard into it; it is no control, so it draws no ring */
      .host-mode-stack :deep([data-host-mode-stack-item]:focus) {
        outline: none;
      }
    </style>
  </template>
}
