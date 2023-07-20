import Component from '@glimmer/component';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { RenderedLinksToCard } from './stack-item';
import { velcro } from 'ember-velcro';
import { Actions } from '@cardstack/runtime-common';
import { IconButton } from '@cardstack/boxel-ui';
import cn from '@cardstack/boxel-ui/helpers/cn';
import { type TrackedArray } from 'tracked-built-ins';
import type { MiddlewareState } from '@floating-ui/dom';
import type { Card } from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { TrackedWeakMap } from 'tracked-built-ins';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';

interface Signature {
  Args: {
    renderedLinksToCards: RenderedLinksToCard[];
    publicAPI: Actions;
    toggleSelect?: (card: Card) => void;
    selectedCards?: TrackedArray<Card>;
  };
}

export default class OperatorModeOverlays extends Component<Signature> {
  <template>
    {{#each this.renderedCardWithEvents as |renderedCard|}}
      {{#let renderedCard.card (this.isSelected renderedCard.card) as |card isSelected|}}
        <div
          class={{cn 'actions-overlay' selected=isSelected hovered=(eq this.currentlyHoveredCard renderedCard)}}
          {{velcro renderedCard.element middleware=(Array this.offset)}}
          data-test-overlay-selected={{if isSelected card.id}}
        >
          {{!-- Add mouseenter and mouseleave events to each button, so we can maintain the hover effect. --}}
          {{#if @toggleSelect}}
            <IconButton
              {{on 'click' (fn @toggleSelect card)}}
              {{on 'mouseenter' (fn this.setCurrentlyHoverCard renderedCard)}}
              {{on 'mouseleave' (fn this.setCurrentlyHoverCard null)}}
              class='hover-button select'
              @icon={{if isSelected 'icon-circle-selected' 'icon-circle'}}
              aria-label='select card'
              data-test-overlay-select={{card.id}}
            />
          {{/if}}
          <IconButton
            {{on 'mouseenter' (fn this.setCurrentlyHoverCard renderedCard)}}
            {{on 'mouseleave' (fn this.setCurrentlyHoverCard null)}}
            class='hover-button preview'
            @icon='eye'
            aria-label='preview card'
          />
          <IconButton
            {{on 'mouseenter' (fn this.setCurrentlyHoverCard renderedCard)}}
            {{on 'mouseleave' (fn this.setCurrentlyHoverCard null)}}
            class='hover-button more-actions'
            @icon='more-actions'
            aria-label='more actions'
          />
        </div>
      {{/let}}
    {{/each}}
    <style>
      .actions-overlay {
        border-radius: var(--boxel-border-radius);
        pointer-events: none;
      }
      .actions-overlay.selected {
        box-shadow: 0 0 0 2px var(--boxel-highlight);
      }
      .hovered {
        box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.16);
      }
      .hover-button {
        display: none;
        position: absolute;
        width: 30px;
        height: 30px;
        pointer-events: auto;
      }
      .hovered > .hover-button:not(:disabled),
      .hovered > .hover-button.select {
        display: block;
      }
      .hover-button:not(:disabled):hover {
        --icon-color: var(--boxel-highlight);
        --icon-border: var(--boxel-highlight);
      }
      .hover-button.select {
        top: 0;
        right: 0;
      }
      .hover-button.preview {
        top: 0;
        left: 0;
      }
      .hover-button.more-actions {
        bottom: 0;
        right: 0;
      }
      .hover-button > svg {
        height: 100%;
      }
    </style>
  </template>

  @tracked currentlyHoveredCard: RenderedLinksToCard | null = null;
  areEventsRegistered = new TrackedWeakMap<RenderedLinksToCard, boolean>();

  offset = {
    name: 'offset',
    fn: (state: MiddlewareState) => {
      let { elements, rects } = state;
      let { floating, reference } = elements;
      let { width, height } = reference.getBoundingClientRect();

      floating.style.width = width + 'px';
      floating.style.height = height + 'px';
      floating.style.position = 'absolute';
      return {
        x: rects.reference.x,
        y: rects.reference.y,
      };
    },
  };

  // Since we disable pointer events of this overlay component,
  // we register events on the underlying rendered card.
  // This ensures that we can maintain the same hover and click effects.
  get renderedCardWithEvents() {
    let renderedCards = this.args.renderedLinksToCards;
    for (const renderedCard of renderedCards) {
      if (this.areEventsRegistered.get(renderedCard)) continue;
      renderedCard.element.addEventListener(
        'mouseenter',
        (_e: MouseEvent) => (this.currentlyHoveredCard = renderedCard)
      );
      renderedCard.element.addEventListener(
        'mouseleave',
        (_e: MouseEvent) => (this.currentlyHoveredCard = null)
      );
      renderedCard.element.addEventListener('click', (_e: MouseEvent) =>
        this.openOrSelectCard(renderedCard.card)
      );
      renderedCard.element.style.cursor = 'pointer';
    }

    return renderedCards;
  }

  setCurrentlyHoverCard = (renderedCard: RenderedLinksToCard | null) => {
    this.currentlyHoveredCard = renderedCard;
  };

  @action openOrSelectCard(card: Card) {
    if (this.args.toggleSelect && this.args.selectedCards?.length) {
      this.args.toggleSelect(card);
    } else {
      this.args.publicAPI.viewCard(card);
    }
  }

  @action isSelected(card: Card) {
    return this.args.selectedCards?.some((c: Card) => c === card);
  }

  // TODO: actions for 'preview' and 'more-actions' buttons
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    OperatorModeOverlays: typeof OperatorModeOverlays;
  }
}
