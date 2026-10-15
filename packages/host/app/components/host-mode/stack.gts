import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import { modifier } from 'ember-modifier';

import HostModeStackItem from './stack-item';

interface Signature {
  Element: HTMLElement;
  Args: {
    stackItemCardIds: string[];
    close?: (cardId: string) => void;
  };
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  let tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

function focusIfConnected(element: Element | null | undefined): boolean {
  if (element instanceof HTMLElement && element.isConnected) {
    element.focus({ preventScroll: true });
    return document.activeElement === element;
  }
  return false;
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
      // focusable by script only, so it never becomes a Tab stop
      item.tabIndex = -1;
      item.focus({ preventScroll: true });
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

  willDestroy() {
    super.willDestroy();
    // the last card has closed and the stack goes with it
    focusIfConnected(this.openers[0]);
  }

  @action
  onKeydown(event: KeyboardEvent) {
    if (
      event.key !== 'Escape' ||
      event.defaultPrevented ||
      isTextEntry(event.target)
    ) {
      return;
    }
    event.preventDefault();
    this.closeTopCard();
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

      /* the top card takes focus from script as it opens, to carry the
         keyboard into it; it is no control, so it draws no ring */
      .host-mode-stack :deep([data-host-mode-stack-item]:focus) {
        outline: none;
      }
    </style>
  </template>
}
