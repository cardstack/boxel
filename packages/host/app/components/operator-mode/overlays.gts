import Component from '@glimmer/component';
import { fn, array } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { RenderedCardForOverlayActions } from './stack-item';
import { velcro } from 'ember-velcro';
import { Actions } from '@cardstack/runtime-common';
import { BoxelDropdown, IconButton } from '@cardstack/boxel-ui';
import cn from '@cardstack/boxel-ui/helpers/cn';
import { type TrackedArray } from 'tracked-built-ins';
import type { MiddlewareState } from '@floating-ui/dom';
import type { Card, Format } from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { TrackedWeakMap } from 'tracked-built-ins';
import { cardTypeDisplayName } from '@cardstack/runtime-common';
import { and, eq, not } from '@cardstack/host/helpers/truth-helpers';
import { bool } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import BoxelMenu from '@cardstack/boxel-ui/components/menu';
import menuItem from '@cardstack/boxel-ui/helpers/menu-item';

import { service } from '@ember/service';
import CardService from '@cardstack/host/services/card-service';
import { load } from 'ember-async-data';

interface Signature {
  Args: {
    renderedCardsForOverlayActions: RenderedCardForOverlayActions[];
    publicAPI: Actions;
    toggleSelect?: (card: Card) => void;
    selectedCards?: TrackedArray<Card>;
  };
}

export default class OperatorModeOverlays extends Component<Signature> {
  @service declare cardService: CardService;

  isEmbeddedCard(renderedCard: RenderedCardForOverlayActions) {
    return (
      renderedCard.fieldType === 'contains' ||
      renderedCard.fieldType === 'linksTo'
    );
  }

  @action async getRealmInfo(card: Card) {
    return this.cardService.getRealmInfo(card);
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
          data-test-overlay-card-display-name={{cardTypeDisplayName card}}
        >
          {{#if (this.isEmbeddedCard renderedCard)}}
            <div class='overlay-embedded-card-header' data-test-overlay-header>
              <div class='header-title'>
                <div class='header-icon'>
                  {{#if (eq renderedCard.fieldType 'contains')}}
                    {{svgJar 'icon-turn-down-right' width='22px' height='18px'}}
                  {{else}}
                    {{#let (load (this.getRealmInfo card)) as |result|}}
                      <img
                        src={{result.value.iconURL}}
                        alt="Card's realm icon"
                      />
                    {{/let}}
                  {{/if}}
                </div>
                <div class='header-text'>
                  {{cardTypeDisplayName card}}
                </div>
              </div>

              <div class='header-actions'>
                {{! Offer to edit embedded card only when the stack item is in edit mode  }}
                {{#if (eq renderedCard.stackItem.format 'edit')}}
                  <IconButton
                    @icon='icon-pencil'
                    @width='24px'
                    @height='24px'
                    class='icon-button'
                    aria-label='Edit'
                    data-test-embedded-card-edit-button
                    {{on
                      'click'
                      (fn this.openOrSelectCard renderedCard.card 'edit')
                    }}
                  />
                {{/if}}

                <BoxelDropdown>
                  <:trigger as |bindings|>
                    <IconButton
                      @icon='icon-horizontal-three-dots'
                      @width='20px'
                      @height='20px'
                      class='icon-button icon-options'
                      aria-label='Options'
                      data-test-embedded-card-options-button
                      {{bindings}}
                    />
                  </:trigger>
                  <:content as |dd|>
                    <BoxelMenu
                      @closeMenu={{dd.close}}
                      @items={{array
                        (menuItem
                          'View card'
                          (fn this.openOrSelectCard renderedCard.card)
                        )
                      }}
                    />
                  </:content>
                </BoxelDropdown>
              </div>

            </div>

            <IconButton
              {{on 'mouseenter' (fn this.setCurrentlyHoveredCard renderedCard)}}
              {{on 'mouseleave' (fn this.setCurrentlyHoveredCard null)}}
              class='hover-button hover-button-embedded-card preview'
              @icon='eye'
              aria-label='preview card'
            />
          {{/if}}

          {{#if
            (and (bool @toggleSelect) (not (this.isEmbeddedCard renderedCard)))
          }}
            <IconButton
              {{! @glint-ignore (glint thinks toggleSelect is not in this scope but it actually is - we check for it in the condition above) }}
              {{on 'click' (fn @toggleSelect card)}}
              {{on 'mouseenter' (fn this.setCurrentlyHoveredCard renderedCard)}}
              {{on 'mouseleave' (fn this.setCurrentlyHoveredCard null)}}
              class='hover-button select'
              @icon={{if isSelected 'icon-circle-selected' 'icon-circle'}}
              aria-label='select card'
              data-test-overlay-select={{card.id}}
            />
            <IconButton
              {{on 'mouseenter' (fn this.setCurrentlyHoveredCard renderedCard)}}
              {{on 'mouseleave' (fn this.setCurrentlyHoveredCard null)}}
              class='hover-button preview'
              @icon='eye'
              aria-label='preview card'
            />
            <IconButton
              {{on 'mouseenter' (fn this.setCurrentlyHoveredCard renderedCard)}}
              {{on 'mouseleave' (fn this.setCurrentlyHoveredCard null)}}
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
      .hovered .hover-button:not(:disabled),
      .hovered .hover-button.select {
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
        visibility: collapse; /* remove this line to no longer hide the preview icon */
      }
      .hover-button.more-actions {
        bottom: 0;
        right: 0;
      }
      .hover-button.hover-button-embedded-card {
        left: calc(100% - var(--boxel-sp-xl));
        top: calc(
          (100% - var(--overlay-embedded-card-header-height)) / 2 +
            var(--overlay-embedded-card-header-height) - 1em
        );
        position: absolute;
      }
      .hover-button > svg {
        height: 100%;
      }
      .icon-button {
        margin: auto;
      }
      .overlay-embedded-card-header {
        background: var(--boxel-light-100);
        height: var(--overlay-embedded-card-header-height);
        display: flex;
      }
      .icon-button:hover {
        --icon-bg: var(--boxel-teal);
        --icon-border: none;
        --icon-color: var(--boxel-teal);
        background: var(--boxel-light);
      }
      .header-text {
        display: inline-block;
        margin: 0;
        color: var(--boxel-label-color);
        font: 700 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-sm);
      }
      .header-icon {
        display: flex;
        margin-right: var(--boxel-sp-xxxs);
      }
      .header-actions {
        margin-left: auto;
        display: flex;
        margin-right: var(--boxel-sp-xs);
      }
      .header-actions > button {
        margin-left: var(--boxel-sp-xxxs);
        pointer-events: auto; /* pointer events are disabled in the overlay, we re-enable it here for header actions */
        display: flex;
        border-radius: 4px;
        height: calc(
          var(--overlay-embedded-card-header-height) - 2 * var(--boxel-sp-xxs)
        );
        width: calc(
          var(--overlay-embedded-card-header-height) - 2 * var(--boxel-sp-xxs)
        );
      }
      .header-title {
        padding: 1em;
        display: flex;
      }
      .header-actions > button:hover {
        --icon-bg: var(--boxel-light);
        background: var(--boxel-teal);
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

  // Since we put absolutely positined overlays containing operator mode actions on top of the rendered cards,
  // we are running into a problem where the overlays are interfering with scrolling of the container that holds the rendered cards.
  // That means scrolling stops when the cursor gets over the overlay, which is a bug. We solved this problem by disabling pointer
  // events on the overlay. However, that prevents the browser from detecting hover state, which is needed to show the operator mode actions, and
  // click event, needed to open the card. To solve this, we add event listeners to the rendered cards underneath the overlay, and use those to
  // detect hover state and click event.
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
      renderedCard.element.addEventListener('click', (e: MouseEvent) => {
        // prevent outer nested contains fields from triggering when inner most
        // contained field was clicked
        e.stopPropagation();
        this.openOrSelectCard(renderedCard.card);
      });
      renderedCard.element.style.cursor = 'pointer';
    }

    return renderedCards;
  }

  setCurrentlyHoveredCard = (
    renderedCard: RenderedCardForOverlayActions | null
  ) => {
    this.currentlyHoveredCard = renderedCard;
  };

  @action openOrSelectCard(card: Card, format: Format = 'isolated') {
    if (this.args.toggleSelect && this.args.selectedCards?.length) {
      this.args.toggleSelect(card);
    } else {
      this.args.publicAPI.viewCard(card, format);
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
