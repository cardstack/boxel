import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';

import { consume } from 'ember-provide-consume-context';
import { velcro } from 'ember-velcro';

import type { BoxelDropdownAPI } from '@cardstack/boxel-ui/components';
import {
  BoxelDropdown,
  IconButton,
  Menu,
  Tooltip,
} from '@cardstack/boxel-ui/components';

import {
  cn,
  copyCardURLToClipboard,
  or,
  toMenuItems,
} from '@cardstack/boxel-ui/helpers';
import type { MenuItemOptions } from '@cardstack/boxel-ui/helpers';

import {
  Eye,
  IconCircle,
  IconCircleSelected,
  IconLink,
  IconPencil,
  IconTrash,
  ThreeDotsHorizontal,
} from '@cardstack/boxel-ui/icons';

import type { CommandContext } from '@cardstack/runtime-common';

import {
  CardCrudFunctionsContextName,
  CommandContextName,
  getMenuItems,
} from '@cardstack/runtime-common';

import type {
  CardCrudFunctions,
  CardDef,
  Format,
} from '@cardstack/base/card-api';

import { detectStackItemTypeForTarget } from '../../lib/stack-item';

import { removeFileExtension } from '../card-search/utils';
import { knownFileMetaUrls } from '../prerendered-card-search';

import Overlays from './overlays';

import type { StackItemRenderedCardForOverlayActions } from './stack-item';

import type { CardDefOrId } from './stack-item';
import type StoreService from '../../services/store';

export default class OperatorModeOverlays extends Overlays {
  overlayClassName = 'actions-overlay';
  @service declare private store: StoreService;

  @consume(CardCrudFunctionsContextName)
  declare private cardCrudFunctions: CardCrudFunctions;

  @consume(CommandContextName)
  declare private commandContext: CommandContext;

  get renderedCardsForOverlayActionsWithEvents() {
    return super
      .renderedCardsForOverlayActionsWithEvents as StackItemRenderedCardForOverlayActions[];
  }

  <template>
    {{#each this.renderedCardsForOverlayActionsWithEvents as |renderedCard|}}
      {{#let
        renderedCard.cardDefOrId
        (this.getCardId renderedCard.cardDefOrId)
        (this.isSelected renderedCard.cardDefOrId)
        as |cardDefOrId cardId isSelected|
      }}
        {{#if (or isSelected (this.isHovered renderedCard))}}
          <div
            class={{cn
              'actions-overlay'
              selected=isSelected
              hovered=(this.isHovered renderedCard)
            }}
            {{velcro renderedCard.element middleware=(array this.offset)}}
            data-test-overlay-selected={{if
              isSelected
              (removeFileExtension cardId)
            }}
            data-test-overlay-card={{removeFileExtension cardId}}
            style={{renderedCard.overlayZIndexStyle}}
            ...attributes
          >
            <div class={{cn 'actions' field=(this.isField renderedCard)}}>
              {{#if (this.isButtonDisplayed 'select' renderedCard)}}
                <div class='actions-item select'>
                  <IconButton
                    class='actions-item__button'
                    {{! @glint-ignore (glint thinks toggleSelect is not in this scope but it actually is - we check for it in the condition above) }}
                    {{on 'click' (fn @toggleSelect cardDefOrId)}}
                    @width='100%'
                    @height='100%'
                    @icon={{if isSelected IconCircleSelected IconCircle}}
                    aria-label='select card'
                    data-test-overlay-select={{removeFileExtension cardId}}
                  />
                </div>
              {{/if}}
              {{#if
                (or
                  (this.isButtonDisplayed 'edit' renderedCard)
                  (this.isButtonDisplayed 'more-options' renderedCard)
                )
              }}
                <div class='actions-item'>
                  {{#if (this.isButtonDisplayed 'edit' renderedCard)}}
                    <IconButton
                      @icon={{IconPencil}}
                      @width='100%'
                      @height='100%'
                      class='actions-item__button'
                      aria-label='Edit'
                      data-test-overlay-edit
                      {{on
                        'click'
                        (fn
                          this.openOrSelectCard
                          cardDefOrId
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
                        @registerAPI={{this.registerDropdownAPI renderedCard}}
                      >
                        <:trigger as |bindings|>
                          <Tooltip @placement='top'>
                            <:trigger>
                              <IconButton
                                @icon={{ThreeDotsHorizontal}}
                                @width='100%'
                                @height='100%'
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
                          <Menu
                            @closeMenu={{dd.close}}
                            @items={{this.getMenuItemsForCard
                              cardDefOrId
                              renderedCard
                            }}
                          />
                        </:content>
                      </BoxelDropdown>
                    </div>
                  {{/if}}
                </div>
              {{/if}}
            </div>
          </div>
        {{/if}}
      {{/let}}
    {{/each}}
    <style scoped>
      :global(:root) {
        --overlay-fitted-card-header-height: 2.5rem;
      }
      .actions-overlay {
        border-radius: var(--boxel-border-radius);
        pointer-events: none;

        container-name: actions-overlay;
        container-type: size;
      }
      .actions-overlay.selected {
        box-shadow: 0 0 0 var(--boxel-outline-width) var(--boxel-highlight);
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
        border-radius: var(--boxel-border-radius-sm);
        gap: var(--boxel-sp-xxxs);
        box-shadow: 0 3px 3px 0 rgba(0, 0, 0, 0.5);
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
      .selected .actions-item.select {
        visibility: visible;
      }
    </style>
  </template>

  private dropdownAPIs: WeakMap<
    StackItemRenderedCardForOverlayActions,
    BoxelDropdownAPI
  > = new Map();

  @action
  private isButtonDisplayed(
    type: string,
    renderedCard: StackItemRenderedCardForOverlayActions,
  ): boolean {
    switch (type) {
      case 'select':
        return !this.isField(renderedCard) && !!this.args.toggleSelect;
      case 'edit':
        if (this.isFileMetaTarget(renderedCard)) {
          return false;
        }
        return this.realm.canWrite(this.getCardId(renderedCard.cardDefOrId));
      case 'more-options':
        return true;
      default:
        return false;
    }
  }

  private isFileMetaTarget(
    renderedCard: StackItemRenderedCardForOverlayActions,
  ): boolean {
    return this.getTypeForCardTarget(renderedCard.cardDefOrId) === 'file';
  }

  private getTypeForCardTarget(cardDefOrId: CardDefOrId): 'card' | 'file' {
    let type = detectStackItemTypeForTarget(
      cardDefOrId,
      this.getCardId(cardDefOrId),
      this.store,
    );
    if (type === 'file') {
      return type;
    }
    // Fallback: check the internal registry of file-meta URLs populated by
    // prerendered search. The prerendered search only fetches HTML, so the
    // file-meta data may not yet be in the store when the user first clicks.
    if (typeof cardDefOrId === 'string' && knownFileMetaUrls.has(cardDefOrId)) {
      return 'file';
    }
    return type;
  }

  protected override buildViewCardOpts(
    cardDefOrId: CardDefOrId,
    fieldType?: 'linksTo' | 'contains' | 'containsMany' | 'linksToMany',
    fieldName?: string,
  ): {
    type?: 'card' | 'file';
    fieldType?: 'linksTo' | 'contains' | 'containsMany' | 'linksToMany';
    fieldName?: string;
  } {
    return {
      type: this.getTypeForCardTarget(cardDefOrId),
      fieldType,
      fieldName,
    };
  }

  @action
  private registerDropdownAPI(
    renderedCard: StackItemRenderedCardForOverlayActions,
  ) {
    return (dropdownAPI: BoxelDropdownAPI) => {
      if (this.dropdownAPIs.has(renderedCard)) {
        return;
      }

      this.dropdownAPIs.set(renderedCard, dropdownAPI);
    };
  }

  @action
  protected override setCurrentlyHoveredCard(
    renderedCard: StackItemRenderedCardForOverlayActions | null,
  ) {
    // Hide the dropdown content when the overlay is not hovered.
    // Make it visible again when it is hovered.
    let hoveredCard = (this.currentlyHoveredCard ??
      renderedCard) as StackItemRenderedCardForOverlayActions;
    if (hoveredCard) {
      let dropdownContentElement = document.querySelector(
        `#ember-basic-dropdown-content-${
          this.dropdownAPIs.get(hoveredCard)?.uniqueId
        }`,
      );

      if (dropdownContentElement) {
        const dropdownElement = dropdownContentElement as HTMLElement;
        dropdownElement.style.visibility =
          dropdownElement.style.visibility === 'hidden' ? 'visible' : 'hidden';
      }
    }

    super.setCurrentlyHoveredCard(renderedCard);
  }

  /**
   * OperatorModeOverlays specifically needs stackItem.format
   */
  @action
  protected override getFormatForCard(
    renderedCard: StackItemRenderedCardForOverlayActions,
  ): Format {
    if (this.isFileMetaTarget(renderedCard)) {
      return 'isolated';
    }
    return renderedCard.stackItem.format as Format;
  }

  @action
  private getMenuItemsForCard(
    cardDefOrId: CardDefOrId,
    renderedCard: StackItemRenderedCardForOverlayActions,
  ) {
    const isField = this.isField(renderedCard);
    const cardId = this.getCardId(cardDefOrId);

    const viewCardItem: MenuItemOptions = {
      label: 'View card',
      action: () => this.openOrSelectCard(cardDefOrId),
      icon: Eye,
    };

    // When cardDefOrId is a string (e.g., prerendered cards in the grid),
    // we can't call [getMenuItems] on it, so construct default menu items
    if (typeof cardDefOrId === 'string') {
      const menuItems: MenuItemOptions[] = [viewCardItem];
      menuItems.push({
        label: 'Copy Card URL',
        action: () => copyCardURLToClipboard(cardId),
        icon: IconLink,
      });
      if (!isField && this.realm.canWrite(cardId)) {
        menuItems.push({
          label: 'Delete',
          action: () => this.cardCrudFunctions.deleteCard?.(cardDefOrId),
          icon: IconTrash,
          dangerous: true,
        });
      }
      return toMenuItems(menuItems);
    }

    const cardMenuItems =
      (cardDefOrId as CardDef)[getMenuItems]?.({
        canEdit: this.realm.canWrite(cardId),
        cardCrudFunctions: this.cardCrudFunctions,
        menuContext: 'interact',
        commandContext: this.commandContext,
      }) ?? [];

    // Delete and New Card of This Type don't make sense from an embedded field
    // overlay — suppress them by context, not by misreporting canEdit
    const visibleItems = isField
      ? cardMenuItems.filter(
          (item) =>
            item.label !== 'Delete' && item.label !== 'New Card of This Type',
        )
      : cardMenuItems;

    return toMenuItems([viewCardItem, ...visibleItems]);
  }
}
