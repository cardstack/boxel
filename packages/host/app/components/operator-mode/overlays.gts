import Component from '@glimmer/component';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { RenderedCardForOverlayActions } from './stack-item';
import { velcro } from 'ember-velcro';
import { Actions } from '@cardstack/runtime-common';
import { IconButton } from '@cardstack/boxel-ui';
import cn from '@cardstack/boxel-ui/helpers/cn';
import { type TrackedArray } from 'tracked-built-ins';
import type { MiddlewareState } from '@floating-ui/dom';
import type { Card } from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { TrackedWeakMap } from 'tracked-built-ins';
import { cardTypeDisplayName } from '@cardstack/runtime-common';
import { and, eq, not } from '@cardstack/host/helpers/truth-helpers';
import { bool } from '@cardstack/boxel-ui/helpers/truth-helpers';

interface Signature {
  Args: {
    renderedCardsForOverlayActions: RenderedCardForOverlayActions[];
    publicAPI: Actions;
    toggleSelect?: (card: Card) => void;
    selectedCards?: TrackedArray<Card>;
  };
}

export default class OperatorModeOverlays extends Component<Signature> {
  isEmbeddedCard(renderedCard: RenderedCardForOverlayActions) {
    return (
      renderedCard.fieldType === 'contains' ||
      renderedCard.fieldType === 'linksTo'
    );
  }

  <template>
    {{#each this.renderedCardsForOverlayActionsWithEvents as |renderedCard|}}
      {{#let
        renderedCard.card (this.isSelected renderedCard.card)
        as |card isSelected|
      }}
        <div
          class={{cn
            'actions-overlay'
            selected=isSelected
            hovered=(eq this.currentlyHoveredCard renderedCard)
          }}
          {{velcro renderedCard.element middleware=(Array this.offset)}}
          data-test-overlay-selected={{if isSelected card.id}}
        >
          {{! Add mouseenter and mouseleave events to each button, so we can maintain the hover effect. }}
          {{#if (this.isEmbeddedCard renderedCard)}}
            <div class='overlay-embedded-card-header' data-test-overlay-header>
              <div class='header-title'>
                {{! TODO: Icon for linksTo field type }}
                {{#if (eq renderedCard.fieldType 'contains')}}
                  <span class='icon'>
                    ⮑
                  </span>
                {{/if}}

                {{cardTypeDisplayName card}}
              </div>
            </div>
          {{/if}}

          {{#if
            (and (bool @toggleSelect) (not (this.isEmbeddedCard renderedCard)))
          }}
            <IconButton
              {{on 'click' (fn @toggleSelect card)}}
              {{on 'mouseenter' (fn this.setCurrentlyHoverCard renderedCard)}}
              {{on 'mouseleave' (fn this.setCurrentlyHoverCard null)}}
              class='hover-button select'
              @icon={{if isSelected 'icon-circle-selected' 'icon-circle'}}
              aria-label='select card'
              data-test-overlay-select={{card.id}}
            />
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
          {{/if}}
        </div>
      {{/let}}
    {{/each}}
    <style>
      :global(:root) {
        --overlay-embedded-card-header-height: 44px;
      }
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
      .overlay-embedded-card-header {
        background: var(--boxel-light-100);
        height: var(--overlay-embedded-card-header-height);
      }
      .icon-button:hover {
        --icon-bg: var(--boxel-teal);
        --icon-border: none;
        --icon-color: var(--boxel-teal);
        background: var(--boxel-light);
      }
      .header-title {
        display: inline-block;
        margin: 0;
        padding: 13px;
        color: var(--boxel-label-color);
        font: 700 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-sm);
      }
      .header-title > .icon {
        margin-right: var(--boxel-sp-xxxs);
      }

    </style>
  </template>

  @tracked currentlyHoveredCard: RenderedCardForOverlayActions | null = null;
  areEventsRegistered = new TrackedWeakMap<
    RenderedCardForOverlayActions,
    boolean
  >();

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

  // Pointer events of this overlay component
  // will prevent pointer events on rendered cards.
  // This might cause broken functionality in rendered cards,
  // such as the inability to scroll through cards in the cards-grid.
  // Therefore, we have decided to disable pointer events for this overlay component,
  // and instead, we register events directly to the rendered cards.
  // This way, we can maintain the same behavior of hovering and clicking.
  get renderedCardsForOverlayActionsWithEvents() {
    let renderedCards = this.args.renderedCardsForOverlayActions;
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

  setCurrentlyHoverCard = (
    renderedCard: RenderedCardForOverlayActions | null
  ) => {
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
