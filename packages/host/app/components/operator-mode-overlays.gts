import Component from '@glimmer/component';
import { registerDestructor } from '@ember/destroyable';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { TrackedArray } from 'tracked-built-ins';
import { Card } from 'https://cardstack.com/base/card-api';
import { on } from '@ember/modifier';
import { task, timeout } from 'ember-concurrency';
import config from '@cardstack/host/config/environment';
import {
  RenderedLinksToCard,
  StackItem,
} from '@cardstack/host/components/operator-mode';
import { htmlSafe } from '@ember/template';
import { action } from '@ember/object';

interface OverlayedButton {
  x: number;
  y: number;
  zIndex: number;
  linksToCard: Card;
  linksToCardElement: HTMLElement;
}

interface Signature {
  Args: {
    renderedLinksToCards: RenderedLinksToCard[];
    addToStack: (stackItem: StackItem) => void;
  };
}

export default class OperatorModeOverlays extends Component<Signature> {
  <template>
    {{#each this.overlayedButtons as |overlayedButton|}}
      <button
        {{on 'click' (fn this.addToStack overlayedButton.linksToCard)}}
        style={{this.styleForOverlayedButton overlayedButton}}
        class='operator-mode-overlayed-button'
        data-test-cardstack-operator-mode-overlay-button
      >
        Open
      </button>
    {{/each}}
  </template>

  @tracked overlayedButtons = new TrackedArray<OverlayedButton>([]);

  constructor(owner: unknown, args: any) {
    super(owner, args);

    this.refreshOverlayedButtons.perform();

    registerDestructor(this, () => {
      this.refreshOverlayedButtons.cancelAll();
    });
  }

  @action addToStack(card: Card) {
    this.args.addToStack({
      card,
      format: 'isolated',
    });
  }

  styleForOverlayedButton(overlayedButton: OverlayedButton) {
    return htmlSafe(
      `top: ${overlayedButton.y}px; left: ${overlayedButton.x}px; z-index: ${overlayedButton.zIndex}`
    );
  }

  calculateOverlayedButtonCoordinates(linksToCardElement: HTMLElement) {
    let rect = linksToCardElement.getBoundingClientRect();

    // Place the button in the top right of the linksTo card
    return {
      x: rect.width - 40,
      y: rect.y + 10,
    };
  }

  refreshOverlayedButtons = task(async () => {
    let refreshedOverlayedButtons: OverlayedButton[] =
      this.args.renderedLinksToCards.map((renderedLinksToCard) => {
        let { x, y } = this.calculateOverlayedButtonCoordinates(
          renderedLinksToCard.element
        );

        return {
          x,
          y,
          zIndex: renderedLinksToCard.stackedAtIndex + 1,
          linksToCard: renderedLinksToCard.card,
          linksToCardElement: renderedLinksToCard.element,
        };
      });

    let didLayoutChange = refreshedOverlayedButtons.some(
      (refreshedOverlayedButton) => {
        let currentOverlayedButton = this.overlayedButtons.find(
          (previousOverlayedButton) => {
            return (
              previousOverlayedButton.linksToCard.id ===
              refreshedOverlayedButton.linksToCard.id
            );
          }
        );

        return (
          !currentOverlayedButton ||
          currentOverlayedButton.x !== refreshedOverlayedButton.x ||
          currentOverlayedButton.y !== refreshedOverlayedButton.y
        );
      }
    );

    if (didLayoutChange) {
      this.overlayedButtons = new TrackedArray(refreshedOverlayedButtons);
      if (config.environment == 'test') {
        // Cancel continous refreshing when button gets displayed so that the test can finish
        this.refreshOverlayedButtons.cancelAll();
      }
    }

    let refreshRateMs = 40;
    // This rate feels snappy enough for repositioning when resizing and interacting with cards
    // in the stack. Probably could be more performant using some kind of an observer or a
    // reactive mechanism -- but this is a quick solution for now which we can improve later.
    await timeout(refreshRateMs);
    this.refreshOverlayedButtons.perform();
  });
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    OperatorModeOverlays: typeof OperatorModeOverlays;
  }
}
