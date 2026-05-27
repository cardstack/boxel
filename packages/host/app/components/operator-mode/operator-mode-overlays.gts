import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';

import DotsVertical from '@cardstack/boxel-icons/dots-vertical';
import { consume } from 'ember-provide-consume-context';
import { velcro } from 'ember-velcro';

import type { BoxelDropdownAPI } from '@cardstack/boxel-ui/components';
import {
  BoxelDropdown,
  IconButton,
  Menu,
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
  IconLink,
  IconPencil,
  IconTrash,
} from '@cardstack/boxel-ui/icons';

import {
  cardTypeDisplayName,
  cardTypeIcon,
  type CommandContext,
} from '@cardstack/runtime-common';

import {
  CardCrudFunctionsContextName,
  CommandContextName,
  getMenuItems,
} from '@cardstack/runtime-common';

import { removeFileExtension } from '@cardstack/host/utils/card-search/types';

import type {
  BaseDef,
  CardCrudFunctions,
  CardDef,
  FileDef,
  Format,
} from 'https://cardstack.com/base/card-api';

import { htmlComponent } from '../../lib/html-component';
import { detectStackItemTypeForTarget } from '../../lib/stack-item';

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
        (this.isHovered renderedCard)
        as |cardDefOrId cardId isSelected isHovered|
      }}
        {{#if (or isSelected isHovered)}}
          <div
            class={{cn
              'actions-overlay'
              selected=isSelected
              hovered=isHovered
              field=(this.isField renderedCard)
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
            {{! Type-label tab — hover only, anchored top-left, overflows when long }}
            {{#if isHovered}}
              <div
                class='adorn-label'
                data-test-overlay-label
                {{on 'mouseenter' this.cancelHoverClear}}
                {{on 'mouseleave' this.scheduleHoverClear}}
              >
                {{#let
                  (this.getCardTypeIcon cardDefOrId renderedCard)
                  as |TypeIcon|
                }}
                  {{#if TypeIcon}}
                    <TypeIcon class='adorn-label-icon' />
                  {{/if}}
                {{/let}}
                <span class='adorn-label-text'>
                  {{this.getCardTypeName cardDefOrId renderedCard}}
                </span>
                <BoxelDropdown
                  @registerAPI={{this.registerDropdownAPI renderedCard}}
                  @onClose={{this.handleMenuClose}}
                >
                  <:trigger as |bindings|>
                    <IconButton
                      @icon={{DotsVertical}}
                      class='adorn-label-menu'
                      aria-label='Options'
                      data-test-overlay-more-options
                      {{bindings}}
                      {{on
                        'click'
                        (fn this.handleMenuTriggerClick renderedCard)
                      }}
                    />
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

            {{! Selection indicator — bottom-right rounded square chip }}
            {{#if (this.isButtonDisplayed 'select' renderedCard)}}
              <button
                type='button'
                class='adorn-select-button'
                {{! @glint-ignore (glint thinks toggleSelect is not in this scope but it actually is - we check for it in the condition above) }}
                {{on 'click' (fn @toggleSelect cardDefOrId)}}
                aria-label='select card'
                aria-pressed={{if isSelected 'true' 'false'}}
                data-test-overlay-select={{removeFileExtension cardId}}
              >
                {{#if isSelected}}
                  <svg
                    class='adorn-select-icon'
                    viewBox='0 0 14 14'
                    fill='none'
                    aria-hidden='true'
                  >
                    <circle cx='7' cy='7' r='7' fill='#0a2e1c' />
                    <path
                      d='M3.5 7.5L5.5 9.5L10.5 4.5'
                      stroke='currentColor'
                      stroke-width='1.5'
                      stroke-linecap='round'
                      stroke-linejoin='round'
                    />
                  </svg>
                {{else}}
                  <svg
                    class='adorn-select-icon'
                    viewBox='-1 -1 16 16'
                    fill='none'
                    aria-hidden='true'
                  >
                    <circle
                      cx='7'
                      cy='7'
                      r='6.5'
                      stroke='#0a2e1c'
                      stroke-width='1.5'
                    />
                  </svg>
                {{/if}}
              </button>
            {{/if}}
          </div>
        {{/if}}
      {{/let}}
    {{/each}}
    <style scoped>
      .actions-overlay {
        /* Adorn accent palette (local to operator-mode overlay).
           --boxel-teal (#00ffba) is the light accent already in boxel-ui;
           the medium and dark values are exclusive to this overlay. */
        --adorn-accent-light: var(--boxel-teal);
        --adorn-accent: #00da9f;

        pointer-events: none;
        container-name: actions-overlay;
        container-type: size;
        /* Allow the type-label tab and selection chip to extend outside the
           overlay's bounding box without being clipped. */
        overflow: visible;
      }

      /* Hover, not selected: 2px outer stroke */
      .actions-overlay.hovered:not(.selected) {
        box-shadow: 0 0 0 2px var(--adorn-accent-light);
      }

      /* Selected: 4px outer stroke */
      .actions-overlay.selected {
        box-shadow: 0 0 0 4px var(--adorn-accent-light);
      }

      /* Hover on a selected card: stroke shifts to darker accent */
      .actions-overlay.selected.hovered {
        box-shadow: 0 0 0 4px var(--adorn-accent);
      }

      /* Type-label tab — flag shape with sloped right edge, anchored above
         the card's top-left corner so its left edge aligns with the 4px
         selection stroke. */
      .adorn-label {
        position: absolute;
        bottom: calc(100% + 2px);
        left: -4px;
        right: auto;
        top: auto;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        max-width: max-content;
        padding: 3px 12px 3px 7px;
        background: var(--adorn-accent-light);
        color: #0a2e1c;
        font: 700 10px/1 var(--boxel-font-family, inherit);
        letter-spacing: 0.5px;
        text-transform: uppercase;
        white-space: nowrap;
        /* The rounded left corners are part of the clip-path itself (a 4px
           bevel) rather than a separate border-radius. Combining border-radius
           with clip-path leaves a faint light-grey anti-aliasing seam at the
           rounded corners; folding the rounding into the single clip shape so
           the fill and the drop-shadow share identical geometry removes it. */
        clip-path: polygon(
          4px 0,
          calc(100% - 13px) 0,
          100% 100%,
          4px 100%,
          0 calc(100% - 4px),
          0 4px
        );
        pointer-events: auto;
        z-index: 1;
        filter: drop-shadow(0 5px 8px rgba(0, 0, 0, 0.2));
      }
      .actions-overlay.selected .adorn-label {
        background: var(--adorn-accent);
      }
      .adorn-label-icon {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        color: #0a2e1c;
      }
      .adorn-label-text {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .adorn-label-menu {
        width: 18px;
        height: 18px;
        margin-inline-start: 0;
        padding: 2px;
        border-radius: 4px;
        --icon-bg: #0a2e1c;
        --icon-color: #0a2e1c;
        --boxel-icon-button-width: 18px;
        --boxel-icon-button-height: 18px;
      }
      .adorn-label-menu:hover {
        background: rgba(0, 0, 0, 0.12);
      }

      /* Selection indicator — rounded square chip at the bottom-right corner. */
      .adorn-select-button {
        position: absolute;
        bottom: 4px;
        right: 4px;
        width: 20px;
        height: 20px;
        padding: 3px;
        border: none;
        border-radius: 5px;
        background: var(--adorn-accent-light);
        color: var(--adorn-accent-light);
        cursor: pointer;
        pointer-events: auto;
        z-index: 1;
      }
      .adorn-select-icon {
        display: block;
        width: 14px;
        height: 14px;
      }

      /* Field overlays (containsMany items, linksToMany items) don't get the
         select indicator — see isButtonDisplayed('select'). The label tab is
         still useful so it stays. */
      .actions-overlay.field .adorn-select-button {
        display: none;
      }

      /* Compact mode for small atom-format cards */
      @container actions-overlay (aspect-ratio > 2.0) and (height <= 57px) {
        .adorn-label {
          padding: 2px 10px 2px 5px;
          font-size: 9px;
          gap: 4px;
        }
        .adorn-label-icon {
          width: 11px;
          height: 11px;
        }
        .adorn-label-menu {
          width: 14px;
          height: 14px;
          --boxel-icon-button-width: 14px;
          --boxel-icon-button-height: 14px;
        }
        .adorn-select-button {
          width: 16px;
          height: 16px;
          padding: 2px;
          bottom: 2px;
          right: 2px;
        }
        .adorn-select-icon {
          width: 12px;
          height: 12px;
        }
      }
    </style>
  </template>

  private dropdownAPIs: Map<
    StackItemRenderedCardForOverlayActions,
    BoxelDropdownAPI
  > = new Map();
  private openDropdownCount = 0;

  protected override get hoverClearDelayMs(): number {
    // The type-label tab floats a few pixels above the card; the cursor
    // needs to bridge that gap without the chrome dismissing itself.
    return 100;
  }

  protected override shouldDelayHoverClear(): boolean {
    return this.openDropdownCount > 0;
  }

  protected override shouldSwallowCardClick(): boolean {
    return this.openDropdownCount > 0;
  }

  @action
  private handleMenuTriggerClick(
    renderedCard: StackItemRenderedCardForOverlayActions,
  ) {
    // BasicDropdown updates isOpen on the same tick as the click handler;
    // a 0ms timeout lets us read the post-toggle state.
    setTimeout(() => {
      let api = this.dropdownAPIs.get(renderedCard);
      if (api?.isOpen) {
        this.openDropdownCount += 1;
        this.cancelHoverClear();
      }
    }, 0);
  }

  @action
  private handleMenuClose() {
    this.openDropdownCount = Math.max(0, this.openDropdownCount - 1);
    // Now that the menu is gone, see if we should retire the chrome.
    this.scheduleHoverClear();
  }

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
      // Always overwrite. The dropdown trigger lives inside an {{#if
      // isHovered}}, so the BoxelDropdown component re-mounts every time the
      // chip re-appears and emits a fresh API; reading isOpen on a stale
      // (destroyed) instance always returns false.
      this.dropdownAPIs.set(renderedCard, dropdownAPI);
    };
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

  private peekInstance(
    cardDefOrId: CardDefOrId,
    renderedCard?: StackItemRenderedCardForOverlayActions,
  ): BaseDef | undefined {
    if (typeof cardDefOrId !== 'string') {
      return cardDefOrId as BaseDef;
    }
    let isFile = renderedCard != null && this.isFileMetaTarget(renderedCard);
    let instance = isFile
      ? this.store.peek<FileDef>(cardDefOrId, { type: 'file-meta' })
      : this.store.peek<CardDef>(cardDefOrId);
    if (!instance || 'error' in instance) {
      return undefined;
    }
    // Defensive: errored or partial reads may return shapes that don't
    // implement the BaseDef interface (e.g. error envelopes). Only return
    // instances whose constructor exposes getDisplayName, since that's what
    // cardTypeDisplayName / cardTypeIcon rely on.
    let ctor = (instance as { constructor?: unknown }).constructor as
      | { getDisplayName?: unknown }
      | undefined;
    if (typeof ctor?.getDisplayName !== 'function') {
      return undefined;
    }
    return instance as unknown as BaseDef;
  }

  @action
  private getCardTypeName(
    cardDefOrId: CardDefOrId,
    renderedCard: StackItemRenderedCardForOverlayActions,
  ): string {
    let isFile = this.isFileMetaTarget(renderedCard);
    let domName = renderedCard.element?.getAttribute(
      'data-card-type-display-name',
    );
    let instance = this.peekInstance(cardDefOrId, renderedCard);
    let instanceName = instance ? cardTypeDisplayName(instance) : undefined;

    // Prefer a specific class name from either source. The realm-server
    // indexer's getDisplayNames walks the prototype chain and stops at the
    // base FileDef / CardDef — so display_names is empty for bare FileDef /
    // CardDef rows and `cardType` lands as undefined; the in-memory
    // instance returns 'File' / 'Card' for the same case. Both are
    // uninformative; skip them when picking the label.
    let specific = [domName, instanceName].find(
      (name): name is string =>
        typeof name === 'string' && name !== 'File' && name !== 'Card',
    );
    if (specific) {
      return specific;
    }

    // No specific subclass info available. For file rows, derive a hint
    // from the URL extension so the user can still tell file types apart
    // (e.g. 'MD', 'GTS', 'PNG') rather than every file row reading 'FILE'.
    if (isFile) {
      let extName = this.deriveFileTypeFromExtension(cardDefOrId);
      if (extName) {
        return extName;
      }
    }

    return domName ?? instanceName ?? (isFile ? 'File' : 'Card');
  }

  private deriveFileTypeFromExtension(
    cardDefOrId: CardDefOrId,
  ): string | undefined {
    let cardId = this.getCardId(cardDefOrId);
    if (!cardId) return undefined;
    let pathWithoutQuery = cardId.split('?')[0].split('#')[0];
    let lastDot = pathWithoutQuery.lastIndexOf('.');
    let lastSlash = pathWithoutQuery.lastIndexOf('/');
    if (lastDot <= lastSlash || lastDot === pathWithoutQuery.length - 1) {
      return undefined;
    }
    let ext = pathWithoutQuery.slice(lastDot + 1);
    if (!/^[A-Za-z0-9]+$/.test(ext)) {
      return undefined;
    }
    return ext.toUpperCase();
  }

  @action
  private getCardTypeIcon(
    cardDefOrId: CardDefOrId,
    renderedCard: StackItemRenderedCardForOverlayActions,
  ): unknown {
    // Same precedence as getCardTypeName — the realm server stamps the
    // proper subclass icon HTML on the rendered wrapper, which the
    // in-memory FileDef base class can't supply.
    let iconHtml = renderedCard.element?.getAttribute(
      'data-card-type-icon-html',
    );
    if (iconHtml) {
      // htmlComponent caches by source string, so repeat lookups for the
      // same icon return the same component.
      return htmlComponent(iconHtml);
    }
    let instance = this.peekInstance(cardDefOrId, renderedCard);
    if (instance) {
      return cardTypeIcon(instance);
    }
    return undefined;
  }

  @action
  private getMenuItemsForCard(
    cardDefOrId: CardDefOrId,
    renderedCard: StackItemRenderedCardForOverlayActions,
  ) {
    const isField = this.isField(renderedCard);
    const isFile = this.isFileMetaTarget(renderedCard);
    const cardId = this.getCardId(cardDefOrId);

    const viewItem: MenuItemOptions = {
      label: isFile ? 'View file' : 'View card',
      action: () => this.openOrSelectCard(cardDefOrId),
      icon: Eye,
    };

    const editItem: MenuItemOptions | undefined = this.isButtonDisplayed(
      'edit',
      renderedCard,
    )
      ? {
          label: 'Edit',
          action: () =>
            this.openOrSelectCard(
              cardDefOrId,
              'edit',
              renderedCard.fieldType,
              renderedCard.fieldName,
            ),
          icon: IconPencil,
        }
      : undefined;

    const copyUrlItem: MenuItemOptions = {
      label: isFile ? 'Copy File URL' : 'Copy Card URL',
      action: () => copyCardURLToClipboard(cardId),
      icon: IconLink,
    };

    // When cardDefOrId is a string (e.g., prerendered cards in the grid),
    // we can't call [getMenuItems] on it, so construct default menu items
    if (typeof cardDefOrId === 'string') {
      const menuItems: MenuItemOptions[] = [];
      menuItems.push(viewItem);
      if (editItem) {
        menuItems.push(editItem);
      }
      menuItems.push(copyUrlItem);
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

    const leadingItems: MenuItemOptions[] = [];
    if (editItem) {
      leadingItems.push(editItem);
    }
    leadingItems.push(viewItem);

    return toMenuItems([...leadingItems, ...visibleItems]);
  }
}
