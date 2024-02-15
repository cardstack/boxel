import { fn, array } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, task } from 'ember-concurrency';
import { velcro } from 'ember-velcro';
import { type TrackedArray, TrackedWeakMap } from 'tracked-built-ins';

import {
  BoxelDropdown,
  IconButton,
  Menu,
} from '@cardstack/boxel-ui/components';
import { and, bool, cn, eq, menuItem, not } from '@cardstack/boxel-ui/helpers';

import {
  Eye as EyeIcon,
  ThreeDotsHorizontal,
  IconCircle,
  IconCircleSelected,
  IconTrash,
} from '@cardstack/boxel-ui/icons';

import { type Actions, cardTypeDisplayName } from '@cardstack/runtime-common';

import {
  type RealmSessionResource,
  getRealmSession,
} from '@cardstack/host/resources/realm-session';
import type CardService from '@cardstack/host/services/card-service';

import type { CardDef, Format } from 'https://cardstack.com/base/card-api';

import OperatorModeOverlayItemHeader from './overlay-item-header';
import { RenderedCardForOverlayActions } from './stack-item';

import type { MiddlewareState } from '@floating-ui/dom';

interface Signature {
  Args: {
    renderedCardsForOverlayActions: RenderedCardForOverlayActions[];
    publicAPI: Actions;
    toggleSelect?: (card: CardDef) => void;
    selectedCards?: TrackedArray<CardDef>;
  };
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
            hovered=(eq this.currentlyHoveredCard.card.id renderedCard.card.id)
          }}
          {{velcro renderedCard.element middleware=(Array this.offset)}}
          data-test-overlay-selected={{if isSelected card.id}}
          data-test-overlay-card={{card.id}}
          data-test-overlay-card-display-name={{cardTypeDisplayName card}}
        >
          {{#if (this.isIncludeHeader renderedCard)}}
            <OperatorModeOverlayItemHeader
              @item={{renderedCard}}
              @openOrSelectCard={{this.openOrSelectCard}}
            />
            <IconButton
              {{on 'mouseenter' (fn this.setCurrentlyHoveredCard renderedCard)}}
              {{on 'mouseleave' (fn this.setCurrentlyHoveredCard null)}}
              class='hover-button hover-button-embedded-card preview'
              @icon={{EyeIcon}}
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
              @icon={{if isSelected IconCircleSelected IconCircle}}
              aria-label='select card'
              data-test-overlay-select={{card.id}}
            />
            <IconButton
              {{on 'mouseenter' (fn this.setCurrentlyHoveredCard renderedCard)}}
              {{on 'mouseleave' (fn this.setCurrentlyHoveredCard null)}}
              class='hover-button preview'
              @icon={{EyeIcon}}
              aria-label='preview card'
            />
            {{#let (this.canWrite card) as |canWrite|}}
              {{! Since there is just one item in the drop down, if that one item 
                  cannot be shown then we just don't show the drop down. This should 
                  change if we add more items in the dropdown }}
              {{#if canWrite}}
                <BoxelDropdown>
                  <:trigger as |bindings|>
                    <IconButton
                      {{on
                        'mouseenter'
                        (fn this.setCurrentlyHoveredCard renderedCard)
                      }}
                      {{on 'mouseleave' (fn this.setCurrentlyHoveredCard null)}}
                      class='hover-button more-actions'
                      @icon={{ThreeDotsHorizontal}}
                      aria-label='more actions'
                      {{bindings}}
                    />
                  </:trigger>
                  <:content as |dd|>
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
                    />
                  </:content>
                </BoxelDropdown>
              {{/if}}
            {{/let}}
          {{/if}}
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
    </style>
  </template>

  @service private declare cardService: CardService;
  @tracked private currentlyHoveredCard: RenderedCardForOverlayActions | null =
    null;
  @tracked private realmSessionResourceByCard: TrackedWeakMap<
    CardDef,
    RealmSessionResource
  > = new TrackedWeakMap();
  private realmSessionResources: Map<string, RealmSessionResource> = new Map();

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
        (_e: MouseEvent) => (this.currentlyHoveredCard = renderedCard),
      );
      renderedCard.element.addEventListener(
        'mouseleave',
        // eslint-disable-next-line ember/no-side-effects
        (_e: MouseEvent) => (this.currentlyHoveredCard = null),
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
      this.loadRealmSessionResource.perform(renderedCard.card);
    }

    return renderedCards;
  }

  private isEmbeddedCard(renderedCard: RenderedCardForOverlayActions) {
    return (
      renderedCard.fieldType === 'contains' ||
      renderedCard.fieldType === 'linksTo' ||
      renderedCard.fieldType === 'linksToMany'
    );
  }

  @action
  private isIncludeHeader(renderedCard: RenderedCardForOverlayActions) {
    return this.isEmbeddedCard(renderedCard) && renderedCard.format !== 'atom';
  }

  private setCurrentlyHoveredCard = (
    renderedCard: RenderedCardForOverlayActions | null,
  ) => {
    this.currentlyHoveredCard = renderedCard;
  };

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

  @action private canWrite(card: CardDef) {
    return this.realmSessionResourceByCard.get(card)?.canWrite;
  }

  private viewCard = restartableTask(
    async (
      card: CardDef,
      format: Format = 'isolated',
      fieldType?: 'linksTo' | 'contains' | 'containsMany' | 'linksToMany',
      fieldName?: string,
    ) => {
      await this.args.publicAPI.viewCard(card, format, fieldType, fieldName);
    },
  );

  private loadRealmSessionResource = task(async (card: CardDef) => {
    let realmURL = await this.cardService.getRealmURL(card);
    let resource = this.realmSessionResources.get(realmURL.href);
    if (!resource) {
      resource = getRealmSession(this, { realmURL: () => realmURL });
      await resource.loaded;
      this.realmSessionResources.set(realmURL.href, resource);
    }
    this.realmSessionResourceByCard.set(card, resource);
  });
}
