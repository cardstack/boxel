import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';

import DotsVertical from '@cardstack/boxel-icons/dots-vertical';
import { modifier } from 'ember-modifier';
import { consume } from 'ember-provide-consume-context';
import { velcro } from 'ember-velcro';
import { TrackedSet } from 'tracked-built-ins';

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

import AdornContext from '@cardstack/host/components/adorn/adorn-context';
import AdornLabel from '@cardstack/host/components/adorn/adorn-label';
import AdornSelectChip from '@cardstack/host/components/adorn/adorn-select-chip';

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

// Adorn's `@compact` variant shrinks the label and selection chip
// for narrow atom-format cards. The threshold mirrors what the
// previous CSS @container query used: cards that are wider than 2:1
// and no taller than 57px.
function shouldRenderCompact(width: number, height: number): boolean {
  return height > 0 && height <= 57 && width / height > 2.0;
}

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
    <AdornContext as |adorn|>
      {{#each this.renderedCardsForOverlayActionsWithEvents as |renderedCard|}}
        {{#let
          renderedCard.cardDefOrId
          (this.getCardId renderedCard.cardDefOrId)
          (this.isSelected renderedCard.cardDefOrId)
          (this.isHovered renderedCard)
          (this.isCompact renderedCard.element)
          as |cardDefOrId cardId isSelected isHovered isCompact|
        }}
          {{#if (or isSelected isHovered)}}
            <div
              class={{cn
                'actions-overlay'
                adorn.strokeClass
                selected=isSelected
                hovered=isHovered
                field=(this.isField renderedCard)
                compact=isCompact
              }}
              {{velcro renderedCard.element middleware=(array this.offset)}}
              {{this.trackCompact renderedCard.element}}
              data-test-overlay-selected={{if
                isSelected
                (removeFileExtension cardId)
              }}
              data-test-overlay-card={{removeFileExtension cardId}}
              style={{renderedCard.overlayZIndexStyle}}
              ...attributes
            >
              {{! Type-label tab — hover only. adorn.positionLabel
                  positions the label so it stays inside the
                  enclosing AdornContext's bounds, flips below the
                  card when there isn't room above, and truncates
                  with an ellipsis when it can't fit sideways. }}
              {{#if isHovered}}
                <AdornLabel
                  @compact={{isCompact}}
                  class='overlay-type-label'
                  data-test-overlay-label
                  {{adorn.positionLabel renderedCard.element}}
                  {{on 'mouseenter' this.cancelHoverClear}}
                  {{on 'mouseleave' this.scheduleHoverClear}}
                >
                  <:icon>
                    {{#let
                      (this.getCardTypeIcon cardDefOrId renderedCard)
                      as |TypeIcon|
                    }}
                      {{#if TypeIcon}}
                        <TypeIcon />
                      {{/if}}
                    {{/let}}
                  </:icon>
                  <:text>
                    {{this.getCardTypeName cardDefOrId renderedCard}}
                  </:text>
                  <:dropdown>
                    <BoxelDropdown
                      @registerAPI={{this.registerDropdownAPI renderedCard}}
                      @onClose={{this.handleMenuClose}}
                    >
                      <:trigger as |bindings|>
                        <IconButton
                          @icon={{DotsVertical}}
                          class='overlay-label-menu'
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
                  </:dropdown>
                </AdornLabel>
              {{/if}}

              {{! Selection indicator — wrap the chip in a button so
                  it can be clicked to toggle selection. }}
              {{#if (this.isButtonDisplayed 'select' renderedCard)}}
                <button
                  type='button'
                  class='overlay-select-button'
                  {{! @glint-ignore (glint thinks toggleSelect is not in this scope but it actually is - we check for it in the condition above) }}
                  {{on 'click' (fn @toggleSelect cardDefOrId)}}
                  aria-label='select card'
                  aria-pressed={{if isSelected 'true' 'false'}}
                  data-test-overlay-select={{removeFileExtension cardId}}
                >
                  <AdornSelectChip
                    @selected={{isSelected}}
                    @compact={{isCompact}}
                  />
                </button>
              {{/if}}
            </div>
          {{/if}}
        {{/let}}
      {{/each}}
    </AdornContext>
    <style scoped>
      .actions-overlay {
        pointer-events: none;
        /* Allow the type-label tab and selection chip to extend outside the
           overlay's bounding box without being clipped. */
        overflow: visible;
      }
      /* Switch the label background to the darker accent when the
         underlying card is selected. AdornLabel reads
         `--adorn-label-bg` from any cascading ancestor; setting it here
         propagates down through the rendered label. The hover /
         selection outline is supplied by AdornContext via the stroke
         class it yields, applied to the overlay above. */
      .actions-overlay.selected {
        --adorn-label-bg: var(--adorn-accent);
      }
      /* Position the type-label tab within the overlay. trackLabelOverflow
         writes the inline `top`/`left` each frame; the overlay itself is
         pointer-events:none, so the label re-enables pointer events to
         keep its hover handlers live. The flag shape, colors, and compact
         variant all live in the AdornLabel primitive — this class only
         carries the consumer's placement concerns. */
      .overlay-type-label {
        position: absolute;
        pointer-events: auto;
        z-index: 1;
      }
      .overlay-label-menu {
        width: 1.125rem;
        height: 1.125rem;
        margin-inline-start: 0;
        padding: 0.125rem;
        border-radius: 0.25rem;
        --icon-bg: var(--boxel-highlight-foreground);
        --icon-color: var(--boxel-highlight-foreground);
        --boxel-icon-button-width: 1.125rem;
        --boxel-icon-button-height: 1.125rem;
      }
      .overlay-label-menu:hover {
        background: rgba(0, 0, 0, 0.12);
      }
      /* Selection-toggle button: positions the AdornSelectChip in
         the bottom-right corner of the overlay and turns it into an
         interactive control. */
      .overlay-select-button {
        position: absolute;
        bottom: 0.25rem;
        right: 0.25rem;
        padding: 0;
        border: none;
        background: none;
        cursor: pointer;
        pointer-events: auto;
        z-index: 1;
      }
      /* Field overlays (containsMany items, linksToMany items) don't get the
         select indicator — see isButtonDisplayed('select'). The label tab is
         still useful so it stays. */
      .actions-overlay.field .overlay-select-button {
        display: none;
      }
      /* Compact-mode sizing for the operator-mode-specific elements
         (the menu trigger and the select button). The AdornLabel /
         AdornSelectChip primitives get their compact variant from
         the `@compact` arg we pass to each of them directly. */
      .actions-overlay.compact .overlay-label-menu {
        width: 0.875rem;
        height: 0.875rem;
        --boxel-icon-button-width: 0.875rem;
        --boxel-icon-button-height: 0.875rem;
      }
      .actions-overlay.compact .overlay-select-button {
        bottom: 0.125rem;
        right: 0.125rem;
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

  // Tracks which rendered cards are currently small enough to warrant
  // the Adorn compact treatment (narrow atom-format cards). The set
  // is updated by `trackCompact` as cards resize; `isCompact` reads
  // from it on each render so the template can pass `@compact` to the
  // AdornLabel / AdornSelectChip primitives and toggle a `.compact`
  // class on the overlay.
  private compactCards = new TrackedSet<HTMLElement>();

  // Single ResizeObserver shared across all overlay elements in this
  // component. Each `trackCompact` modifier instance registers its
  // overlay element via `observe()` and unregisters via `unobserve()`
  // on teardown — so the per-overlay overhead is one WeakMap entry
  // and one entry in the observer's observation set, no per-overlay
  // ResizeObserver instance.
  private overlayToCard = new WeakMap<HTMLElement, HTMLElement>();
  private compactObserver =
    typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver((entries) => {
          for (let entry of entries) {
            let overlay = entry.target as HTMLElement;
            let cardEl = this.overlayToCard.get(overlay);
            if (!cardEl) continue;
            let { width, height } = entry.contentRect;
            let isCompact = shouldRenderCompact(width, height);
            if (isCompact && !this.compactCards.has(cardEl)) {
              this.compactCards.add(cardEl);
            } else if (!isCompact && this.compactCards.has(cardEl)) {
              this.compactCards.delete(cardEl);
            }
          }
        });

  private trackCompact = modifier(
    (overlay: HTMLElement, [cardEl]: [HTMLElement | undefined]) => {
      if (!cardEl) {
        return undefined;
      }
      this.overlayToCard.set(overlay, cardEl);
      this.compactObserver?.observe(overlay);
      // Seed the initial state; the observer won't have fired yet.
      let { width, height } = overlay.getBoundingClientRect();
      if (shouldRenderCompact(width, height)) {
        this.compactCards.add(cardEl);
      }
      return () => {
        this.compactObserver?.unobserve(overlay);
        this.overlayToCard.delete(overlay);
        this.compactCards.delete(cardEl);
      };
    },
  );

  willDestroy() {
    super.willDestroy?.();
    this.compactObserver?.disconnect();
  }

  @action
  private isCompact(cardEl: HTMLElement | undefined): boolean {
    return cardEl ? this.compactCards.has(cardEl) : false;
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
