import { fn } from '@ember/helper';
import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { scheduleOnce } from '@ember/runloop';
import { service } from '@ember/service';
import type { SafeString } from '@ember/template';
import { htmlSafe } from '@ember/template';

import { isTesting } from '@embroider/macros';

import Component from '@glimmer/component';

import { tracked, cached } from '@glimmer/tracking';

import DeselectIcon from '@cardstack/boxel-icons/deselect';
import Maximize from '@cardstack/boxel-icons/maximize';
import SelectAllIcon from '@cardstack/boxel-icons/select-all';
import { restartableTask, timeout, dropTask } from 'ember-concurrency';
import Modifier from 'ember-modifier';
import { provide, consume } from 'ember-provide-consume-context';

import pluralize from 'pluralize';
import { TrackedSet } from 'tracked-built-ins';

import {
  CardContainer,
  CardHeader,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import {
  MenuDivider,
  MenuItem,
  copyCardURLToClipboard,
  getContrastColor,
  toMenuItems,
} from '@cardstack/boxel-ui/helpers';
import { cn, cssVar, optional, not } from '@cardstack/boxel-ui/helpers';

import { IconLink, IconTrash } from '@cardstack/boxel-ui/icons';

import type { CommandContext } from '@cardstack/runtime-common';
import {
  type Permissions,
  type getCard,
  type getCards,
  type getCardCollection,
  isFileDefInstance,
  cardTypeDisplayName,
  PermissionsContextName,
  RealmURLContextName,
  GetCardContextName,
  GetCardsContextName,
  GetCardCollectionContextName,
  cardTypeIcon,
  isRealmIndexCardId,
  realmURL,
  localId as localIdSymbol,
  CardContextName,
  CardCrudFunctionsContextName,
  getMenuItems,
  baseCardRef,
} from '@cardstack/runtime-common';

import {
  stackItemTypeToStoreReadType,
  type StackItem,
} from '@cardstack/host/lib/stack-item';
import { urlForRealmLookup } from '@cardstack/host/lib/utils';

import type {
  CardContext,
  CardCrudFunctions,
  CardDef,
} from 'https://cardstack.com/base/card-api';

import consumeContext from '../../helpers/consume-context';
import ElementTracker, {
  type RenderedCardForOverlayActions,
} from '../../resources/element-tracker';
import CardRenderer from '../card-renderer';

import CardError from './card-error';
import DeleteModal from './delete-modal';

import OperatorModeOverlays from './operator-mode-overlays';

import type CardService from '../../services/card-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import type RealmService from '../../services/realm';
import type StoreService from '../../services/store';

export interface StackItemComponentAPI {
  clearSelections: () => void;
  scrollIntoView: (selector: string) => Promise<void>;
  startAnimation: (type: 'closing' | 'movingForward') => Promise<void>;
}

interface Signature {
  Args: {
    item: StackItem;
    stackItems: StackItem[];
    index: number;
    requestDeleteCard?: (card: CardDef | URL | string) => Promise<void>;
    commandContext: CommandContext;
    close: (item: StackItem) => void;
    dismissStackedCardsAbove: (stackIndex: number) => Promise<void>;
    onSelectedCards: (
      selectedCards: CardDefOrId[],
      stackItem: StackItem,
    ) => void;
    setupStackItem: (
      model: StackItem,
      componentAPI: StackItemComponentAPI,
    ) => void;
  };
}

export type CardDefOrId = CardDef | string;

export interface StackItemRenderedCardForOverlayActions extends RenderedCardForOverlayActions {
  stackItem: StackItem;
}

export default class OperatorModeStackItem extends Component<Signature> {
  @consume(GetCardContextName) declare private getCard: getCard;
  @consume(GetCardsContextName) declare private getCards: getCards;
  @consume(GetCardCollectionContextName)
  declare private getCardCollection: getCardCollection;
  @consume(CardContextName) declare private cardContext: CardContext;
  @consume(CardCrudFunctionsContextName)
  declare private cardCrudFunctions: CardCrudFunctions;

  @service declare private cardService: CardService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;
  @service declare private store: StoreService;

  @tracked private selectedCards = new TrackedSet<string>();

  private normalizeCardId(cardDefOrId: CardDefOrId): string {
    if (typeof cardDefOrId === 'string') {
      return cardDefOrId;
    }
    return cardDefOrId.id ?? cardDefOrId[localIdSymbol];
  }

  @tracked private showDeleteModal = false;
  @tracked private numberOfCardsToDelete = 0;
  @tracked private isDeletingCards = false;
  @tracked private deleteError: string | undefined;
  @tracked private animationType:
    | 'opening'
    | 'closing'
    | 'movingForward'
    | undefined = 'opening';
  @tracked private cardResource: ReturnType<getCard> | undefined;
  private contentEl: HTMLElement | undefined;
  private containerEl: HTMLElement | undefined;
  private itemEl: HTMLElement | undefined;

  @provide(PermissionsContextName)
  get permissions(): Permissions | undefined {
    if (this.url) {
      return this.realm.permissions(this.url);
    } else if (this.card?.[realmURL]) {
      return this.realm.permissions(this.card[realmURL]?.href);
    }
    return undefined;
  }

  @provide(RealmURLContextName)
  get realmURL() {
    return this.card ? this.card[realmURL] : undefined;
  }

  cardTracker = new ElementTracker();

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.args.setupStackItem(this.args.item, {
      clearSelections: this.clearSelections,
      scrollIntoView: this.scrollIntoViewTask.perform,
      startAnimation: this.startAnimation.perform,
    });
  }

  private makeCardResource = () => {
    this.cardResource = this.getCard(this, () => this.args.item.id, {
      type: stackItemTypeToStoreReadType(this.args.item.type),
    });
  };

  private get url() {
    return this.card?.id ?? this.cardError?.id;
  }

  private get renderedCardsForOverlayActions(): StackItemRenderedCardForOverlayActions[] {
    return this.cardTracker
      .filter(
        [
          { format: 'data' },
          { fieldType: 'linksTo' },
          { fieldType: 'linksToMany' },
        ],
        'or',
        // the only linksTo field with isolated format is in the index card,
        // we don't want to show overlays for those cards here
        { exclude: [{ fieldType: 'linksTo', format: 'isolated' }] },
      )
      .map((entry) => ({
        ...entry,
        stackItem: this.args.item,
      }));
  }

  private get isItemFullWidth() {
    return !this.isBuried && this.isWideFormat;
  }

  private get styleForStackedCard(): SafeString {
    const stackItemMaxWidth = 50; // unit: rem, 800px for 16px base
    const RATIO = 1.2;
    //  top card: 800px / (1.2 ^ 0) = 800px;
    //  buried card: 800px / (1.2 ^ 1) = ~666px;
    //  next buried card: 800px / (1.2 ^ 2) = ~555px;
    const maxWidthReductionPercent = 10; // Every new card on the stack is 10% wider than the previous one (for narrow viewport)
    const numberOfCards = this.args.stackItems.length;
    const invertedIndex = numberOfCards - this.args.index - 1;
    const isLastCard = this.args.index === numberOfCards - 1;
    const isSecondLastCard = this.args.index === numberOfCards - 2;

    // Expanded mode opts out of stacked-layout sizing — let natural
    // flow size the card so .item.expanded CSS rules apply cleanly
    // without fighting inline !important overrides. Mirrors host-mode
    // pattern: parent constrains height, children inherit.
    if (this.isExpanded) {
      return htmlSafe(`z-index: calc(${this.args.index} + 1);`);
    }

    let marginTopPx = 0;

    if (invertedIndex > 2) {
      marginTopPx = -5; // If there are more than 3 cards, those cards are buried behind the header
    }

    if (numberOfCards > 1) {
      if (isLastCard) {
        marginTopPx = numberOfCards === 2 ? 30 : 50;
      } else if (isSecondLastCard && numberOfCards > 2) {
        marginTopPx = 25;
      }
    }

    let maxWidthPercent = 100 - invertedIndex * maxWidthReductionPercent;
    let width = this.isItemFullWidth
      ? '100%'
      : `${stackItemMaxWidth / Math.pow(RATIO, invertedIndex)}rem`;

    let styles = `
      height: calc(100% - ${marginTopPx}px);
      width: ${width};
      max-width: ${maxWidthPercent}%;
      z-index: calc(${this.args.index} + 1);
      margin-top: ${marginTopPx}px;
    `; // using margin-top instead of padding-top to hide scrolled content from view
    // Transition (280ms ease-out, all geometric props) is on the .item
    // CSS rule below — no inline override here, so expand/collapse
    // morph + stacked-layout shifts all use the same curve.

    return htmlSafe(styles);
  }

  private get isBuried() {
    return this.args.index + 1 < this.args.stackItems.length;
  }

  private get isTopCard() {
    return !this.isBuried;
  }

  private get isIndexCard() {
    return isRealmIndexCardId(this.url, this.realmURL);
  }

  // Element ref captured by submode-layout's expanded-card-header-slot.
  // Only used when isExpanded — projects the CardHeader into the top
  // bar pill, replacing the inline card header for the expanded mode.
  // Returns null when not expanded so the inline header renders as
  // usual (and the if/else branch picks the inline path).
  private get expandedCardHeaderSlot() {
    if (!this.isExpanded) return null;
    return this.operatorModeStateService.expandedCardHeaderElement;
  }

  @provide(CardContextName)
  // @ts-ignore "context" is declared but not used
  private get context(): StackItemCardContext {
    return {
      ...this.cardContext,
      cardComponentModifier: this.cardTracker.trackElement,
    };
  }

  private closeItem = () => this._closeItem.perform();

  // Per-card expanded state. Persisted on operatorModeStateService
  // (keyed by stack-item instance) so the user's expand intent survives:
  //   - When this card is buried (pushed deeper in the stack),
  //     isExpanded reads as false (we render normally), but the
  //     stored intent is preserved.
  //   - When the card pops back to the top, isExpanded reads true
  //     again from storage and the card re-expands.
  private get itemExpandKey(): string {
    return this.args.item.instanceId;
  }
  private get isExpandedIntent(): boolean {
    return this.operatorModeStateService.isStackItemExpanded(
      this.itemExpandKey,
    );
  }
  private get isExpanded(): boolean {
    return this.isTopCard && this.isExpandedIntent;
  }
  private toggleExpanded = () => {
    if (!this.isTopCard) return;
    const cardEl = this.itemEl;
    const cardFrom = cardEl?.getBoundingClientRect();

    this.operatorModeStateService.setStackItemExpanded(
      this.itemExpandKey,
      !this.isExpandedIntent,
    );

    // FLIP via Web Animations on the card body: measure rect before
    // state change, animate inverse transform back to identity after
    // re-render. Works around CSS transitions not firing when changing
    // properties cross from inline-style to CSS-rule sources mid-frame.
    if (!cardEl || !cardFrom) return;
    this.pendingFlipEl = cardEl;
    this.pendingFlipFrom = cardFrom;
    scheduleOnce('afterRender', this, this.runExpandAnimation);
  };

  private pendingFlipEl: HTMLElement | null = null;
  private pendingFlipFrom: DOMRect | null = null;

  private runExpandAnimation() {
    const cardEl = this.pendingFlipEl;
    const cardFrom = this.pendingFlipFrom;
    this.pendingFlipEl = null;
    this.pendingFlipFrom = null;
    if (!cardEl || !cardFrom) return;
    this.playFlip(cardEl, cardFrom, {
      duration: 280,
      easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    });
    // Header gets a lightweight fade + small Y slide — suggests
    // direction without the full FLIP's visual noise. Expand: pill
    // slides UP into the bar (starts 10px below). Restore: header
    // slides DOWN onto the card (starts 10px above). A second afterRender
    // pass lets {{#in-element}} settle before measuring.
    scheduleOnce('afterRender', this, this.animateHeaderTransition);
  }

  private animateHeaderTransition() {
    const headerTo = this.findHeaderEl();
    if (!headerTo) return;
    const fromOffsetY = this.isExpandedIntent ? 28 : -28;
    headerTo.animate(
      [
        { opacity: 0, transform: `translateY(${fromOffsetY}px)` },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      {
        duration: 280,
        easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        fill: 'none',
      },
    );
  }

  private findHeaderEl(): HTMLElement | null {
    // After expand: the portaled .expanded-card-header-pill in the bar.
    // Before expand (or after restore): the inline .stack-item-header
    // inside this stack-item's DOM.
    const slot = this.operatorModeStateService.expandedCardHeaderElement;
    const portaled = slot?.querySelector(
      '.expanded-card-header-pill',
    ) as HTMLElement | null;
    if (portaled) return portaled;
    return (
      (this.itemEl?.querySelector(
        '.stack-item-header',
      ) as HTMLElement | null) ?? null
    );
  }

  private playFlip(
    el: HTMLElement,
    fromRect: DOMRect,
    opts: { duration: number; easing: string },
  ) {
    const toRect = el.getBoundingClientRect();
    const dx = fromRect.left - toRect.left;
    const dy = fromRect.top - toRect.top;
    // Guard against zero target dimensions (e.g., during unmount or
    // before layout settles) — Web Animations would NaN out otherwise.
    if (toRect.width === 0 || toRect.height === 0) return;
    const sx = fromRect.width / toRect.width;
    const sy = fromRect.height / toRect.height;
    el.animate(
      [
        {
          transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
          transformOrigin: 'top left',
        },
        {
          transform: 'translate(0, 0) scale(1, 1)',
          transformOrigin: 'top left',
        },
      ],
      {
        duration: opts.duration,
        easing: opts.easing,
        fill: 'none',
      },
    );
  }

  private _closeItem = dropTask(async () => {
    // Clear any persisted expand intent for this item — the item is
    // about to be removed from the stack, so the entry on the
    // service map should not linger (would re-apply if a card with
    // the same id ever returned).
    this.operatorModeStateService.setStackItemExpanded(
      this.itemExpandKey,
      false,
    );
    await this.args.dismissStackedCardsAbove(this.args.index - 1);
  });

  @action private toggleSelect(cardDefOrId: CardDefOrId) {
    const cardId = this.normalizeCardId(cardDefOrId);

    if (this.selectedCards.has(cardId)) {
      this.selectedCards.delete(cardId);
    } else {
      this.selectedCards.add(cardId);
    }

    // pass a copy of the array so that this doesn't become a
    // back door into mutating the state of this component
    this.args.onSelectedCards([...this.selectedCards], this.args.item);
  }

  private clearSelections = () => {
    this.selectedCards.clear();
  };

  private selectAll = () => {
    // Get all selectable cards from the current view using cardTracker
    const availableCards = this.renderedCardsForOverlayActions.map((entry) =>
      this.normalizeCardId(entry.cardDefOrId),
    );

    // Add all available cards to the set (Set naturally handles duplicates)
    availableCards.forEach((cardId) => {
      this.selectedCards.add(cardId);
    });

    // Notify parent component of selection changes
    this.args.onSelectedCards([...this.selectedCards], this.args.item);
  };

  private confirmAndDeleteSelected = () => {
    this.numberOfCardsToDelete = this.selectedCards.size;
    this.showDeleteModal = true;
    this.deleteError = undefined;
  };

  private cancelDelete = () => {
    this.showDeleteModal = false;
    this.numberOfCardsToDelete = 0;
    this.deleteError = undefined;
  };

  private performBulkDelete = async () => {
    this.isDeletingCards = true;
    this.deleteError = undefined;

    const selectedIds = [...this.selectedCards];
    const failedDeletes: string[] = [];
    let successfulDeletes = 0;

    try {
      // Delete cards sequentially to avoid overwhelming the server
      for (const cardId of selectedIds) {
        try {
          await this.operatorModeStateService.deleteCard(cardId);
          successfulDeletes++;

          // Remove successfully deleted card from selection
          this.selectedCards.delete(cardId);
        } catch (error) {
          console.error('Failed to delete card:', error);
          failedDeletes.push(cardId);
        }
      }

      // Handle results and show appropriate message
      if (failedDeletes.length === 0) {
        // All deletions successful
        this.showDeleteModal = false;
        this.numberOfCardsToDelete = 0;
        this.selectedCards.clear();
        console.debug(`Successfully deleted ${successfulDeletes} items`);
      } else if (successfulDeletes > 0) {
        // Partial success
        this.deleteError = `Deleted ${successfulDeletes} of ${selectedIds.length} items. ${failedDeletes.length} failed.`;
        // Keep modal open for retry option
      } else {
        // All deletions failed
        this.deleteError = `Failed to delete ${selectedIds.length} items. Please try again.`;
      }
    } catch (error) {
      console.error('Bulk delete operation failed:', error);
      this.deleteError = 'An unexpected error occurred. Please try again.';
    } finally {
      this.isDeletingCards = false;

      // Notify parent component of selection changes
      this.args.onSelectedCards([...this.selectedCards], this.args.item);
    }
  };

  private get utilityMenu() {
    if (this.selectedCards.size === 0) {
      return undefined;
    }

    const selectedCount = this.selectedCards.size;
    const availableCards = this.renderedCardsForOverlayActions;
    const totalAvailableCount = availableCards.length;
    const allSelected = selectedCount >= totalAvailableCount;

    const menuItems: (MenuItem | MenuDivider)[] = [];

    // Add "Select All" option if not all cards are selected
    if (!allSelected && totalAvailableCount > selectedCount) {
      menuItems.push(
        new MenuItem({
          label: 'Select All',
          icon: SelectAllIcon,
          action: this.selectAll,
          disabled: false,
        }),
      );
    }

    // Add "Deselect All" option
    menuItems.push(
      new MenuItem({
        label: 'Deselect All',
        icon: DeselectIcon,
        action: this.clearSelections,
      }),
    );

    menuItems.push(new MenuDivider());

    // Add "Delete N items" option
    menuItems.push(
      new MenuItem({
        label: `Delete ${selectedCount} item${selectedCount > 1 ? 's' : ''}`,
        action: this.confirmAndDeleteSelected,
        icon: IconTrash,
        dangerous: true,
      }),
    );

    return {
      triggerText: `${selectedCount} Selected`,
      menuItems,
    };
  }

  private get cardIdentifier() {
    return this.url;
  }

  private get headerType() {
    if (this.isIndexCard) {
      return 'Workspace';
    } else if (this.card) {
      return cardTypeDisplayName(this.card);
    }
    return undefined;
  }

  private get headerTitle() {
    let cardTitle = this.card?.cardTitle;
    if (this.card && cardTitle?.startsWith('Untitled ')) {
      let strippedTitle = cardTitle.slice('Untitled '.length);
      if (strippedTitle === cardTypeDisplayName(this.card)) {
        return 'Untitled';
      }
    }

    return cardTitle;
  }

  private get cardTitle() {
    return this.card ? this.card.cardTitle : undefined;
  }

  private get moreOptionsMenuItemsForErrorCard() {
    if (this.isBuried) {
      return undefined;
    }
    return [
      new MenuItem({
        label: 'Copy Card URL',
        action: () =>
          this.cardIdentifier && copyCardURLToClipboard(this.cardIdentifier),
        icon: IconLink,
        disabled: !this.cardIdentifier,
      }),
      new MenuItem({
        label: 'Delete Card',
        action: () =>
          this.cardIdentifier &&
          this.cardCrudFunctions.deleteCard?.(this.cardIdentifier),
        icon: IconTrash,
        dangerous: true,
        disabled: !this.cardCrudFunctions.deleteCard,
      }),
    ];
  }

  private get moreOptionsMenuItems() {
    if (this.isBuried) {
      return undefined;
    }

    const items = toMenuItems(
      this.card?.[getMenuItems]?.({
        canEdit: this.url ? this.realm.canWrite(this.url as string) : false,
        cardCrudFunctions: this.cardCrudFunctions,
        menuContext: 'interact',
        commandContext: this.args.commandContext,
        format: this.cardFormat,
        useBaseTemplate: this.args.item.useBaseTemplate,
      }) ?? [],
    );

    if (this.isTopCard) {
      let expandItem = new MenuItem({
        label: this.isExpanded ? 'Restore Width' : 'Expand to Full Width',
        icon: Maximize,
        action: this.toggleExpanded,
      });
      let copyAsMarkdownIndex = items.findIndex(
        (item) => item.label === 'Copy as Markdown',
      );

      if (copyAsMarkdownIndex > -1) {
        items.splice(copyAsMarkdownIndex + 1, 0, expandItem);
      } else {
        items.push(expandItem);
      }
    }

    return items;
  }

  @cached
  private get card() {
    return this.cardResource?.card;
  }

  private get urlForRealmLookup() {
    if (!this.card) {
      throw new Error(
        `bug: cannot determine url for card realm lookup when there is no card. this is likely a template error, card must be present before this is invoked in template`,
      );
    }
    return urlForRealmLookup(this.card);
  }

  @cached
  private get cardError() {
    return this.cardResource?.cardError;
  }

  private get isWideFormat() {
    if (!this.card) {
      return false;
    }
    let { constructor } = this.card;
    return Boolean(
      constructor &&
      'prefersWideFormat' in constructor &&
      constructor.prefersWideFormat,
    );
  }

  private get headerColor() {
    if (!this.card) {
      return undefined;
    }
    let cardDef = this.card.constructor;
    if (!cardDef || !('headerColor' in cardDef)) {
      return undefined;
    }
    if (cardDef.headerColor == null) {
      return undefined;
    }
    return cardDef.headerColor as string;
  }

  private doneEditing = () => {
    let item = this.args.item;
    let { request } = item;
    if (this.card) {
      request?.fulfill(this.card.id);
    }
    // Mutate format in place — keeps the StackItem instance, so the
    // CardRenderer subtree stays mounted (no remount, no scroll loss,
    // no width snap from prefersWideFormat re-evaluation) for CardDefs
    // that share a template between isolated + edit formats.
    this.operatorModeStateService.setItemFormat(item, 'isolated', { request });
  };

  private scrollIntoViewTask = restartableTask(async (selector: string) => {
    if (!this.contentEl || !this.containerEl) {
      return;
    }
    await timeout(500); // need to wait for DOM to update with new card(s)

    let item = document.querySelector(selector);
    if (!item) {
      return;
    }
    item.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await timeout(1000);
    // ember-velcro uses visibility: hidden to hide items (vs display: none).
    // visibility:hidden alters the geometry of the DOM elements such that
    // scrollIntoView thinks the container itself is scrollable (it's not) because of
    // the additional height that the hidden velcro-ed items are adding and
    // scrolls the entire container (including the header). this is a workaround
    // to reset the scroll position for the container. I tried adding middleware to alter
    // the hiding behavior for ember-velcro, but for some reason the state
    // used to indicate if the item is visible is not available to middleware...
    this.containerEl.scrollTop = 0;
  });

  private startAnimation = dropTask(
    async (animationType: 'closing' | 'movingForward') => {
      this.animationType = animationType;
      await new Promise<void>((resolve) => {
        scheduleOnce(
          'afterRender',
          this,
          this.handleAnimationCompletion,
          animationType,
          resolve,
        );
      });
    },
  );

  private handleAnimationCompletion(
    animationName: 'opening' | 'closing' | 'movingForward',
    resolve?: () => void,
  ) {
    if (!this.itemEl) {
      this.clearAnimationType(animationName);
      resolve?.();
      return;
    }
    const animations = this.itemEl.getAnimations?.() ?? [];
    if (animations.length === 0) {
      this.clearAnimationType(animationName);
      resolve?.();
      return;
    }
    Promise.all(animations.map((animation) => animation.finished))
      .then(() => {
        this.clearAnimationType(animationName);
        resolve?.();
      })
      .catch((e) => {
        // AbortError is expected in two scenarios:
        // 1. Multiple stack items are animating in parallel (eg. closing and moving forward)
        //    and some elements get removed before their animations complete
        // 2. Tests running with animation-duration: 0s can cause
        //    animations to abort before they're properly tracked
        if (e.name === 'AbortError') {
          this.clearAnimationType(animationName);
          resolve?.();
        } else {
          console.error(e);
        }
      });
  }

  private clearAnimationType(
    animationName: 'opening' | 'closing' | 'movingForward',
  ) {
    if (this.animationType === animationName) {
      this.animationType = undefined;
    }
  }

  private trackOpeningAnimation = () => {
    if (this.animationType !== 'opening') {
      return;
    }
    scheduleOnce('afterRender', this, this.finishOpeningAnimation);
  };

  private finishOpeningAnimation = () => {
    this.handleAnimationCompletion('opening');
  };

  private setupContentEl = (el: HTMLElement) => {
    this.contentEl = el;
  };

  private setupContainerEl = (el: HTMLElement) => {
    this.containerEl = el;
  };

  private get canEdit() {
    return (
      this.card &&
      this.card[realmURL] &&
      !this.isBuried &&
      !this.isEditing &&
      !this.isFileCard &&
      this.realm.canWrite(this.card[realmURL].href)
    );
  }

  private get isEditing() {
    return (
      !this.isBuried && !this.isFileCard && this.args.item.format === 'edit'
    );
  }

  private get isFileCard() {
    return (
      this.args.item.type === 'file' ||
      (this.card ? isFileDefInstance(this.card) : false)
    );
  }

  private get keyboardShortcutLabels() {
    return {
      // Pencil button in view mode → enter edit (Ctrl+E on every platform;
      // Cmd+E is reserved by browsers for "Use Selection for Find").
      edit: this.isFileCard ? undefined : 'Ctrl+E',
      // Pencil button in edit mode → exit to view (Esc or Ctrl+E).
      finishEditing: this.isFileCard ? undefined : 'Esc or Ctrl+E',
      // Close button: Esc only closes when not editing — in edit mode
      // Esc means "exit edit", so don't claim it in the close tooltip.
      close: this.isEditing ? undefined : 'Esc',
    };
  }

  private get cardFormat() {
    return this.isFileCard ? 'isolated' : this.args.item.format;
  }

  private get defaultCodeRef() {
    return this.args.item.useBaseTemplate ? baseCardRef : undefined;
  }

  private get showError() {
    // in edit format, prefer showing the stale card if possible so user can
    // attempt to fix the card error
    if (this.cardError && this.args.item.format === 'edit' && this.card) {
      return false;
    }
    return Boolean(this.cardError);
  }

  private setupItemEl = (el: HTMLElement) => {
    this.itemEl = el;
    this.trackOpeningAnimation();
  };

  private get doOpeningAnimation() {
    return (
      this.isTopCard &&
      this.animationType === 'opening' &&
      !this.isEditing &&
      !(this.args.item.format === 'isolated' && this.args.item.request) // Skip animation if we have a request and we're in isolated format, it means we're completing an edit operation
    );
  }

  private get doClosingAnimation() {
    return this.animationType === 'closing';
  }

  private get doMovingForwardAnimation() {
    return this.animationType === 'movingForward';
  }

  private get isTesting() {
    return isTesting();
  }

  private setWindowTitle = () => {
    if (this.url && this.cardTitle) {
      this.operatorModeStateService.setCardTitle(this.url, this.cardTitle);
    }
  };

  private get cardErrorHeaderOptions() {
    if (!this.cardError) {
      return undefined;
    }
    return {
      isTopCard: this.isTopCard,
      moreOptionsMenuItems: this.moreOptionsMenuItemsForErrorCard,
      onClose: !this.isBuried ? this.closeItem : undefined,
    };
  }

  <template>
    {{consumeContext this.makeCardResource}}
    <div
      class={{cn
        'item'
        buried=this.isBuried
        expanded=this.isExpanded
        opening-animation=this.doOpeningAnimation
        closing-animation=this.doClosingAnimation
        move-forward-animation=this.doMovingForwardAnimation
        testing=this.isTesting
      }}
      data-test-stack-card-index={{@index}}
      data-test-stack-card={{this.cardIdentifier}}
      {{! In order to support scrolling cards into view
      we use a selector that is not pruned out in production builds }}
      data-stack-card={{this.cardIdentifier}}
      style={{this.styleForStackedCard}}
      {{ContentElement onSetup=this.setupItemEl}}
    >
      <CardContainer
        class='stack-item-card'
        style={{cssVar
          card-error-header-height='var(--stack-item-header-height)'
        }}
        {{ContentElement onSetup=this.setupContainerEl}}
      >
        {{#if (not this.cardResource.isLoaded)}}
          <div class='loading' data-test-stack-item-loading-card>
            <LoadingIndicator @color='var(--boxel-dark)' />
            <span class='loading__message'>Loading card...</span>
          </div>
        {{else if this.showError}}
          {{! this is for types--this.cardError is always true in this case !}}
          {{#if this.cardError}}
            <CardError
              @error={{this.cardError}}
              @viewInCodeMode={{true}}
              @headerOptions={{this.cardErrorHeaderOptions}}
              class='stack-item-header'
              style={{cssVar
                boxel-card-header-icon-container-min-width=(if
                  this.isBuried '50px' '95px'
                )
                boxel-card-header-actions-min-width=(if
                  this.isBuried '50px' '95px'
                )
                boxel-card-header-background-color=this.headerColor
                boxel-card-header-text-color=(getContrastColor this.headerColor)
                realm-icon-background-color=(getContrastColor
                  this.headerColor 'transparent'
                )
                realm-icon-border-color=(getContrastColor
                  this.headerColor 'transparent' 'rgba(0 0 0 / 15%)'
                )
              }}
              role={{if this.isBuried 'button' 'banner'}}
              {{on
                'click'
                (optional
                  (if this.isBuried (fn @dismissStackedCardsAbove @index))
                )
              }}
              data-test-stack-card-header
            />
          {{/if}}
        {{else if this.card}}
          {{this.setWindowTitle}}
          {{#let (this.realm.info this.urlForRealmLookup) as |realmInfo|}}
            {{#if this.expandedCardHeaderSlot}}
              {{#in-element this.expandedCardHeaderSlot}}
                <CardHeader
                  @cardTypeDisplayName={{this.headerType}}
                  @cardTypeIcon={{cardTypeIcon this.card}}
                  @cardTitle={{this.headerTitle}}
                  @isSaving={{this.cardResource.autoSaveState.isSaving}}
                  @isTopCard={{this.isTopCard}}
                  @lastSavedMessage={{this.cardResource.autoSaveState.lastSavedErrorMsg}}
                  @moreOptionsMenuItems={{this.moreOptionsMenuItems}}
                  @realmInfo={{realmInfo}}
                  @utilityMenu={{this.utilityMenu}}
                  @onEdit={{if
                    this.canEdit
                    (fn this.cardCrudFunctions.editCard this.card)
                  }}
                  @onExpand={{if this.isExpanded this.toggleExpanded}}
                  @isExpanded={{this.isExpanded}}
                  @onFinishEditing={{if this.isEditing this.doneEditing}}
                  @onClose={{unless this.isBuried this.closeItem}}
                  class='expanded-card-header-pill'
                  data-test-stack-card-header
                />
              {{/in-element}}
            {{else}}
              <CardHeader
                @cardTypeDisplayName={{this.headerType}}
                @cardTypeIcon={{cardTypeIcon this.card}}
                @cardTitle={{this.headerTitle}}
                @isSaving={{this.cardResource.autoSaveState.isSaving}}
                @isTopCard={{this.isTopCard}}
                @lastSavedMessage={{this.cardResource.autoSaveState.lastSavedErrorMsg}}
                @moreOptionsMenuItems={{this.moreOptionsMenuItems}}
                @realmInfo={{realmInfo}}
                @utilityMenu={{this.utilityMenu}}
                @onEdit={{if
                  this.canEdit
                  (fn this.cardCrudFunctions.editCard this.card)
                }}
                @onExpand={{if this.isExpanded this.toggleExpanded}}
                @isExpanded={{this.isExpanded}}
                @onFinishEditing={{if this.isEditing this.doneEditing}}
                @onClose={{unless this.isBuried this.closeItem}}
                @editShortcutHint={{this.keyboardShortcutLabels.edit}}
                @finishEditingShortcutHint={{this.keyboardShortcutLabels.finishEditing}}
                @closeShortcutHint={{this.keyboardShortcutLabels.close}}
                class='stack-item-header'
                style={{cssVar
                  boxel-card-header-icon-container-min-width=(if
                    this.isBuried '50px' '95px'
                  )
                  boxel-card-header-actions-min-width=(if
                    this.isBuried '50px' '95px'
                  )
                  boxel-card-header-background-color=this.headerColor
                  boxel-card-header-text-color=(getContrastColor
                    this.headerColor
                  )
                  realm-icon-background-color=(getContrastColor
                    this.headerColor 'transparent'
                  )
                  realm-icon-border-color=(getContrastColor
                    this.headerColor 'transparent' 'rgba(0 0 0 / 15%)'
                  )
                }}
                role={{if this.isBuried 'button' 'banner'}}
                {{on
                  'click'
                  (optional
                    (if this.isBuried (fn @dismissStackedCardsAbove @index))
                  )
                }}
                data-test-stack-card-header
              />
            {{/if}}
          {{/let}}
          <div
            class='stack-item-content'
            {{ContentElement onSetup=this.setupContentEl}}
            data-test-stack-item-content
          >
            <CardRenderer
              class='stack-item-preview'
              @card={{this.card}}
              @format={{this.cardFormat}}
              @codeRef={{this.defaultCodeRef}}
            />
            <OperatorModeOverlays
              @renderedCardsForOverlayActions={{this.renderedCardsForOverlayActions}}
              @requestDeleteCard={{@requestDeleteCard}}
              @toggleSelect={{this.toggleSelect}}
              @selectedCards={{this.selectedCards}}
              @viewCard={{this.cardCrudFunctions.viewCard}}
            />
          </div>
        {{/if}}
      </CardContainer>
    </div>
    <style scoped>
      :global(:root) {
        --stack-card-footer-height: 6rem;
      }

      @keyframes scaleIn {
        from {
          transform: scale(0.1);
          opacity: 0;
        }
        to {
          transform: scale(1);
          opacity: 1;
        }
      }
      @keyframes fadeOut {
        from {
          opacity: 1;
          transform: translateY(0);
        }
        to {
          opacity: 0;
          transform: translateY(100%);
        }
      }

      @keyframes moveForward {
        from {
          transform: translateY(0);
          opacity: 0.8;
        }
        to {
          transform: translateY(25px);
          opacity: 1;
        }
      }

      .item {
        --stack-item-header-height: 3rem;
        justify-self: center;
        position: absolute;
        width: 89%;
        height: inherit;
        z-index: 0;
        pointer-events: none;
        transition:
          margin-top var(--boxel-transition),
          width var(--boxel-transition);
      }
      .item.opening-animation {
        animation: scaleIn 0.2s forwards;
      }
      .item.closing-animation {
        animation: fadeOut 0.2s forwards;
      }
      .item.move-forward-animation {
        animation: moveForward 0.2s none;
      }
      .item.opening-animation.testing {
        animation-duration: 0s;
      }
      .item.closing-animation.testing {
        animation-duration: 0s;
      }
      .item.move-forward-animation.testing {
        animation-duration: 0s;
      }

      .item.buried {
        --stack-item-header-height: 2.5rem;
        --realm-icon-border-radius: 4px;
      }

      .item.expanded {
        top: 0;
        left: 0;
        width: 100%;
        pointer-events: auto;
      }
      /* Propagate height through the chain so bottom-docked chrome
         lands at the viewport's bottom edge. .stack-item-content
         and .stack-item-preview default to overflow: auto with no
         height — without min-height: 0 the chain breaks and the
         studio's flex: 1 has no defined parent height. Keep
         overflow: auto (matches host-mode pattern) so isolated
         content longer than the viewport can scroll. */
      .item.expanded .stack-item-content,
      .item.expanded .stack-item-preview {
        min-height: 0;
      }
      .item.expanded .stack-item-card {
        border-radius: 0;
        box-shadow: none;
        /* Tray "chrome" (rounded corners, shadow, white background)
           all dissolve at end of morph — the tray becomes a
           positioning anchor only. Body content (.stack-item-content)
           inside renders normally without inheriting transparency
           because background, not opacity, is what's faded. */
        background: transparent;
        /* Header is portaled into the top bar pill (see
           expanded-card-header-slot in submode-layout); the inline
           CardHeader is not rendered for expanded cards (the if/else
           in the template picks the in-element branch). Drop the
           grid header row so the body fills the entire card. */
        grid-template-rows: 1fr;
      }
      /* When the top card is expanded, fade out the underlying
         buried cards so the user isn't visually distracted by the
         stack history behind the expanded surface. Sibling selector
         within .operator-mode-stack > .inner; uses :has() to match
         buried items that have an expanded sibling AFTER them in the
         DOM (top card = last in DOM order). */
      .item:not(.expanded):has(~ .item.expanded) {
        opacity: 0;
        transition: opacity 380ms ease;
      }

      .stack-item-card {
        position: relative;
        height: 100%;
        display: grid;
        grid-template-rows: var(--stack-item-header-height) auto;
        border-radius: var(--boxel-border-radius-xl);
        box-shadow: var(--boxel-deep-box-shadow);
        pointer-events: auto;
        overflow: hidden;
      }
      .stack-item-header {
        --boxel-card-header-padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
        border-radius: 0;
        z-index: 1;
        max-width: max-content;
        height: var(--stack-item-header-height);
        min-width: 100%;
      }

      .stack-item-content {
        overflow: auto;
      }

      .stack-item-preview {
        border-radius: 0;
        box-shadow: none;
        overflow: auto;
      }

      .buried > .stack-item-card {
        border-radius: var(--boxel-border-radius-lg);
        background-color: var(--boxel-200);
      }

      .buried .stack-item-header {
        font: 600 var(--boxel-font-xs);
        gap: var(--boxel-sp-xxxs);
        --boxel-card-header-text-font: var(--boxel-font-size-xs);
        --boxel-card-header-realm-icon-size: var(--boxel-icon-sm);
        --boxel-card-header-card-type-icon-size: var(--boxel-icon-xs);
      }

      .buried .stack-item-content {
        display: none;
      }

      .loading {
        grid-area: 2;
        display: flex;
        justify-content: center;
        align-items: center;
        height: calc(100% - var(--stack-item-header-height));
        padding: var(--boxel-sp);
        color: var(--boxel-dark);

        --icon-color: var(--boxel-dark);
      }
      .loading__message {
        margin-left: var(--boxel-sp-5xs);
      }
      .loading :deep(.boxel-loading-indicator) {
        display: flex;
        justify: center;
        align-items: center;
      }

      /* The portaled CardHeader inside takes pill styling — white
         rounded box, realm icon left-docked, actions right-docked,
         left-justified type/title. Reuses CardHeader's existing
         actions structure; just re-skinned via this class. */
      .expanded-card-header-pill {
        --boxel-card-header-padding: var(--boxel-sp-4xs)
          var(--operator-mode-spacing);
        --boxel-card-header-gap: var(--operator-mode-spacing);
        height: var(--container-button-size);
        background: var(--boxel-light);
        border-radius: var(--boxel-border-radius-2xl);
        box-shadow: var(--submode-bar-item-box-shadow);
        outline: var(--submode-bar-item-outline);
      }
      /* Title in the expanded pill stays left-justified inside the
         center column (overrides CardHeader's default text-align: center). */
      .expanded-card-header-pill :deep(.card-type-display-name) {
        text-align: left;
        text-box-trim: trim-both;
      }
      /* Pencil button in expanded edit mode — solid green with dark
         icon for contrast (matches the active expand button). */
      .expanded-card-header-pill :deep(.icon-save),
      .expanded-card-header-pill :deep(.icon-save:hover) {
        background-color: var(--boxel-highlight);
        color: var(--boxel-dark);
      }
    </style>

    {{! Delete confirmation modal }}
    {{#if this.showDeleteModal}}
      <DeleteModal
        @itemToDelete={{hash
          id='bulk-delete'
          selectedCount=this.numberOfCardsToDelete
        }}
        @isDeleteRunning={{this.isDeletingCards}}
        @error={{this.deleteError}}
        @onConfirm={{this.performBulkDelete}}
        @onCancel={{this.cancelDelete}}
      >
        <:content>
          Delete
          {{this.numberOfCardsToDelete}}
          {{pluralize 'card' this.numberOfCardsToDelete}}?
        </:content>
      </DeleteModal>
    {{/if}}
  </template>
}

interface ContentElementSignature {
  Args: {
    Named: {
      onSetup: (element: HTMLElement) => void;
    };
  };
}
class ContentElement extends Modifier<ContentElementSignature> {
  modify(
    element: HTMLElement,
    _positional: [],
    { onSetup }: ContentElementSignature['Args']['Named'],
  ) {
    onSetup(element);
  }
}
