import { fn, array } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { dropTask } from 'ember-concurrency';
import { velcro } from 'ember-velcro';
import { type TrackedArray } from 'tracked-built-ins';

import {
  BoxelDropdown,
  IconButton,
  Menu,
  Tooltip,
  BoxelDropdownAPI,
} from '@cardstack/boxel-ui/components';
import { cn, menuItem } from '@cardstack/boxel-ui/helpers';

import {
  ThreeDotsHorizontal,
  IconCircle,
  IconCircleSelected,
  IconPencil,
  IconTrash,
} from '@cardstack/boxel-ui/icons';

import { type Actions, cardTypeDisplayName } from '@cardstack/runtime-common';

import type CardService from '@cardstack/host/services/card-service';

import RealmService from '@cardstack/host/services/realm';

import type { CardDef, Format } from 'https://cardstack.com/base/card-api';

import { RenderedCardForOverlayActions } from './stack-item';

import type { MiddlewareState } from '@floating-ui/dom';

interface Signature {
  Args: {
    renderedCardsForOverlayActions: RenderedCardForOverlayActions[];
    publicAPI: Actions;
    toggleSelect?: (card: CardDef) => void;
    selectedCards?: TrackedArray<CardDef>;
  };
  Element: HTMLElement;
}

let boundRenderedCardElement = new WeakSet<HTMLElement>();

export default class OperatorModeOverlays extends Component<Signature> {
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
            hovered=(this.isHovered card)
          }}
          {{velcro renderedCard.element middleware=(Array this.offset)}}
          data-test-overlay-selected={{if isSelected card.id}}
          data-test-overlay-card={{card.id}}
          data-test-overlay-card-display-name={{cardTypeDisplayName card}}
          style={{this.zIndexStyle renderedCard.element}}
          {{on 'mouseenter' (fn this.setCurrentlyHoveredCard renderedCard)}}
          {{on 'mouseleave' (fn this.setCurrentlyHoveredCard null)}}
          ...attributes
        >
          <div class={{cn 'actions' field=(this.isField renderedCard)}}>
            {{#if (this.isButtonDisplayed 'select' renderedCard)}}
              <div class='actions-item'>
                <IconButton
                  class='actions-item__button'
                  {{! @glint-ignore (glint thinks toggleSelect is not in this scope but it actually is - we check for it in the condition above) }}
                  {{on 'click' (fn @toggleSelect card)}}
                  @width='auto'
                  @height='auto'
                  @icon={{if isSelected IconCircleSelected IconCircle}}
                  aria-label='select card'
                  data-test-overlay-select={{card.id}}
                />
              </div>
            {{/if}}
            <div class='actions-item'>
              {{#if (this.isButtonDisplayed 'edit' renderedCard)}}
                <IconButton
                  @icon={{IconPencil}}
                  @width='auto'
                  @height='auto'
                  class='actions-item__button'
                  aria-label='Edit'
                  data-test-overlay-edit
                  {{on
                    'click'
                    (fn
                      this.openOrSelectCard
                      card
                      'edit'
                      renderedCard.fieldType
                      renderedCard.fieldName
                    )
                  }}
                />
              {{/if}}
              {{#if (this.isButtonDisplayed 'more-options' renderedCard)}}
                <div>
                  <BoxelDropdown
                    @registerAPI={{(this.registerDropdownAPI renderedCard)}}
                    {{on
                      'mouseenter'
                      (fn this.setCurrentlyHoveredCard renderedCard)
                    }}
                    {{on 'mouseleave' (fn this.setCurrentlyHoveredCard null)}}
                  >
                    <:trigger as |bindings|>
                      <Tooltip @placement='top'>
                        <:trigger>
                          <IconButton
                            @icon={{ThreeDotsHorizontal}}
                            @width='auto'
                            @height='auto'
                            class='actions-item__button'
                            aria-label='Options'
                            data-test-overlay-more-options
                            {{bindings}}
                          />
                        </:trigger>
                        <:content>
                          More Options
                        </:content>
                      </Tooltip>
                    </:trigger>
                    <:content as |dd|>
                      {{#if (this.isMenuDisplayed 'view' renderedCard)}}
                        <Menu
                          @closeMenu={{dd.close}}
                          @items={{array
                            (menuItem
                              'View card' (fn this.openOrSelectCard card)
                            )
                          }}
                          {{on
                            'mouseenter'
                            (fn this.setCurrentlyHoveredCard renderedCard)
                          }}
                          {{on
                            'mouseleave'
                            (fn this.setCurrentlyHoveredCard null)
                          }}
                        />
                      {{else if (this.isMenuDisplayed 'delete' renderedCard)}}
                        <Menu
                          @closeMenu={{dd.close}}
                          @items={{array
                            (menuItem
                              'Delete'
                              (fn @publicAPI.delete card)
                              icon=IconTrash
                              dangerous=true
                            )
                          }}
                          {{on
                            'mouseenter'
                            (fn this.setCurrentlyHoveredCard renderedCard)
                          }}
                          {{on
                            'mouseleave'
                            (fn this.setCurrentlyHoveredCard null)
                          }}
                        />
                      {{/if}}
                    </:content>
                  </BoxelDropdown>
                </div>
              {{/if}}
            </div>
          </div>
        </div>
      {{/let}}
    {{/each}}
    <style>
      :global(:root) {
        --overlay-embedded-card-header-height: 2.5rem;
      }
      .actions-overlay {
        border-radius: var(--boxel-border-radius);
        pointer-events: none;

        container-name: actions-overlay;
        container-type: size;
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

      @container actions-overlay (aspect-ratio <= 1.0) {
        .actions {
          --overlay-embedded-card-header-height: 2.2rem;
        }

        .actions-item {
          padding: var(--boxel-sp-5xs);
        }

        .actions-item__button {
          padding: var(--boxel-sp-4xs);
          --boxel-icon-button-width: calc(
            var(--overlay-embedded-card-header-height) -
              calc(var(--boxel-sp-4xs) + var(--boxel-sp-5xs))
          );
          --boxel-icon-button-height: calc(
            var(--overlay-embedded-card-header-height) -
              calc(var(--boxel-sp-4xs) + var(--boxel-sp-5xs))
          );
        }
      }

      @container actions-overlay (aspect-ratio <= 1.0) and (width <= 120px) {
        .actions {
          --overlay-embedded-card-header-height: 1.8rem;
        }

        .actions-item__button {
          padding: var(--boxel-sp-5xs);
          --boxel-icon-button-width: calc(
            var(--overlay-embedded-card-header-height) -
              calc(var(--boxel-sp-5xs) * 2)
          );
          --boxel-icon-button-height: calc(
            var(--overlay-embedded-card-header-height) -
              calc(var(--boxel-sp-5xs) * 2)
          );
        }
      }

      @container actions-overlay (aspect-ratio > 1.0) {
        .actions {
          --overlay-embedded-card-header-height: 2.2rem;
        }

        .actions-item {
          padding: var(--boxel-sp-5xs);
        }

        .actions-item__button {
          padding: var(--boxel-sp-4xs);
          --boxel-icon-button-width: calc(
            var(--overlay-embedded-card-header-height) -
              calc(var(--boxel-sp-4xs) + var(--boxel-sp-5xs))
          );
          --boxel-icon-button-height: calc(
            var(--overlay-embedded-card-header-height) -
              calc(var(--boxel-sp-4xs) + var(--boxel-sp-5xs))
          );
        }
      }

      @container actions-overlay (aspect-ratio > 2.0) and (height <= 57px) {
        .actions {
          --overlay-embedded-card-header-height: 1.5rem;
          margin-top: var(--boxel-sp-5xs);
        }

        .actions-item {
          padding: var(--boxel-sp-6xs);
        }

        .actions-item__button {
          padding: var(--boxel-sp-6xs);
          --boxel-icon-button-width: calc(
            var(--overlay-embedded-card-header-height) -
              calc(var(--boxel-sp-6xs) * 2)
          );
          --boxel-icon-button-height: calc(
            var(--overlay-embedded-card-header-height) -
              calc(var(--boxel-sp-6xs) * 2)
          );
        }
      }
      .hovered .actions {
        visibility: visible;
      }
      .actions {
        visibility: hidden;
        height: auto;
        display: flex;
        justify-content: space-between;

        margin-top: var(--boxel-sp-xxxs);
        margin-left: var(--boxel-sp-xxxs);
        margin-right: var(--boxel-sp-xxxs);
      }
      .actions.field {
        justify-content: flex-end;
      }
      .actions-item {
        display: flex;
        align-items: center;
        background: var(--boxel-light);
        border: 1px solid var(--boxel-450);
        border-radius: 5px;
        gap: var(--boxel-sp-xxxs);
      }
      .actions-item__button {
        --icon-bg: var(--boxel-dark);
        --icon-color: var(--boxel-dark);

        pointer-events: auto; /* pointer events are disabled in the overlay, we re-enable it here for header actions */
        display: flex;
        border-radius: 5px;
      }
      .actions-item__button:hover {
        --icon-bg: var(--boxel-dark);
        --icon-color: var(--boxel-dark);
        background-color: var(--boxel-highlight);
      }
    </style>
  </template>

  @service private declare cardService: CardService;
  @service private declare realm: RealmService;

  @tracked private currentlyHoveredCard: RenderedCardForOverlayActions | null =
    null;

  private offset = {
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

  private dropdownAPIs: WeakMap<
    RenderedCardForOverlayActions,
    BoxelDropdownAPI
  > = new Map();

  // Since we put absolutely positined overlays containing operator mode actions on top of the rendered cards,
  // we are running into a problem where the overlays are interfering with scrolling of the container that holds the rendered cards.
  // That means scrolling stops when the cursor gets over the overlay, which is a bug. We solved this problem by disabling pointer
  // events on the overlay. However, that prevents the browser from detecting hover state, which is needed to show the operator mode actions, and
  // click event, needed to open the card. To solve this, we add event listeners to the rendered cards underneath the overlay, and use those to
  // detect hover state and click event.
  private get renderedCardsForOverlayActionsWithEvents() {
    let renderedCards = this.args.renderedCardsForOverlayActions;
    for (const renderedCard of renderedCards) {
      if (boundRenderedCardElement.has(renderedCard.element)) {
        continue;
      }
      boundRenderedCardElement.add(renderedCard.element);
      renderedCard.element.addEventListener(
        'mouseenter',
        // eslint-disable-next-line ember/no-side-effects
        (_e: MouseEvent) => this.setCurrentlyHoveredCard(renderedCard),
      );
      renderedCard.element.addEventListener(
        'mouseleave',
        // eslint-disable-next-line ember/no-side-effects
        (_e: MouseEvent) => this.setCurrentlyHoveredCard(null),
      );
      renderedCard.element.addEventListener('click', (e: MouseEvent) => {
        // prevent outer nested contains fields from triggering when inner most
        // contained field was clicked
        e.stopPropagation();
        this.openOrSelectCard(
          renderedCard.card,
          renderedCard.stackItem.format,
          renderedCard.fieldType,
          renderedCard.fieldName,
        );
      });
      renderedCard.element.style.cursor = 'pointer';
    }

    return renderedCards;
  }

  @action
  private isButtonDisplayed(
    type: string,
    renderedCard: RenderedCardForOverlayActions,
  ): boolean {
    switch (type) {
      case 'select':
        return !this.isField(renderedCard) && !!this.args.toggleSelect;
      case 'edit':
        return (
          this.isField(renderedCard) &&
          this.realm.canWrite(renderedCard.card.id) &&
          renderedCard.stackItem.format === 'edit'
        );
      case 'more-options':
        return (
          this.isMenuDisplayed('view', renderedCard) ||
          this.isMenuDisplayed('delete', renderedCard)
        );
      default:
        return false;
    }
  }

  @action
  private isMenuDisplayed(
    type: string,
    renderedCard: RenderedCardForOverlayActions,
  ) {
    switch (type) {
      case 'view':
        return this.isField(renderedCard);
      case 'delete':
        return (
          !this.isField(renderedCard) &&
          this.realm.canWrite(renderedCard.card.id)
        );
      default:
        return false;
    }
  }

  private isField(renderedCard: RenderedCardForOverlayActions) {
    return (
      renderedCard.fieldType === 'contains' ||
      renderedCard.fieldType === 'linksTo' ||
      renderedCard.fieldType === 'linksToMany'
    );
  }

  private setCurrentlyHoveredCard = (
    renderedCard: RenderedCardForOverlayActions | null,
  ) => {
    // Hide the dropdown content when the overlay is not hovered.
    // Make it visible again when it is hovered.
    let hoveredCard = this.currentlyHoveredCard ?? renderedCard;
    if (hoveredCard) {
      let dropdownContentElement = document.querySelector(
        `#ember-basic-dropdown-content-${
          this.dropdownAPIs.get(hoveredCard)?.uniqueId
        }`,
      );

      if (!dropdownContentElement) {
        return;
      }

      const dropdownElement = dropdownContentElement as HTMLElement;
      dropdownElement.style.visibility =
        dropdownElement.style.visibility === 'hidden' ? 'visible' : 'hidden';
    }

    this.currentlyHoveredCard = renderedCard;
  };

  @action
  private registerDropdownAPI(renderedCard: RenderedCardForOverlayActions) {
    return (dropdownAPI: BoxelDropdownAPI) => {
      if (this.dropdownAPIs.has(renderedCard)) {
        return;
      }

      this.dropdownAPIs.set(renderedCard, dropdownAPI);
    };
  }

  @action private openOrSelectCard(
    card: CardDef,
    format: Format = 'isolated',
    fieldType?: 'linksTo' | 'contains' | 'containsMany' | 'linksToMany',
    fieldName?: string,
  ) {
    if (this.args.toggleSelect && this.args.selectedCards?.length) {
      this.args.toggleSelect(card);
    } else {
      this.viewCard.perform(card, format, fieldType, fieldName);
    }
  }

  @action private isSelected(card: CardDef) {
    return this.args.selectedCards?.some((c: CardDef) => c === card);
  }

  @action private isHovered(card: CardDef) {
    return this.currentlyHoveredCard?.card.id === card.id;
  }

  private viewCard = dropTask(
    async (
      card: CardDef,
      format: Format = 'isolated',
      fieldType?: 'linksTo' | 'contains' | 'containsMany' | 'linksToMany',
      fieldName?: string,
    ) => {
      let canWrite = this.realm.canWrite(card.id);
      format = canWrite ? format : 'isolated';
      await this.args.publicAPI.viewCard(card, format, fieldType, fieldName);
    },
  );

  private zIndexStyle(element: HTMLElement) {
    let parentElement = element.parentElement!;
    let zIndexParentElement = window
      .getComputedStyle(parentElement)
      .getPropertyValue('z-index');
    let zIndex =
      zIndexParentElement === 'auto'
        ? zIndexParentElement
        : String(Number(zIndexParentElement) + 1);
    return htmlSafe(`z-index: ${zIndex};`);
  }
}
