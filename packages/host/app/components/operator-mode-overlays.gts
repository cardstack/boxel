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
  refreshLoopStartedAt: number | null = null;
  refreshLoopTimeout: number | null = null;

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

    if (config.environment === 'test') {
      // Allow a small time window for overlays to show up in operator mode component tests. After
      // that time passes we need to stop the refresh loop so that the tests don't hang
      this.refreshLoopTimeout = 100;
      window.test__refreshOverlayedButtons = () => {
        this.refreshOverlayedButtons.perform(true);
      };
    }

    this.refreshLoopStartedAt = Date.now();
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
    let cardElementRect = linksToCardElement.getBoundingClientRect();

    let stackElement = linksToCardElement.closest('.operator-mode-card-stack');
    if (!stackElement) {
      throw new Error(
        'Linked card must be nested under .operator-mode-card-stack element'
      );
    }

    // This is absolute x axis distance between the operator mode stack and the card
    let delta =
      cardElementRect.left - stackElement.getBoundingClientRect().left;

    // Places the button in the top right of the linksTo card
    return {
      x: delta + cardElementRect.width - 65, // x starts at the left edge of the operator mode stack
      y: cardElementRect.y,
    };
  }

  refreshOverlayedButtons = task(async (force = false) => {
    if (
      !force &&
      this.refreshLoopTimeout &&
      Date.now() - this.refreshLoopStartedAt! > this.refreshLoopTimeout!
    ) {
      return;
    }

    if (this.args.renderedLinksToCards.length === 0) {
      this.overlayedButtons = new TrackedArray([]);
    }

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
              previousOverlayedButton.linksToCard?.id ===
              refreshedOverlayedButton.linksToCard?.id
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
