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
  MenuItem,
  getContrastColor,
  toMenuItems,
} from '@cardstack/boxel-ui/helpers';
import { cssVar, optional, not } from '@cardstack/boxel-ui/helpers';

import { IconTrash } from '@cardstack/boxel-ui/icons';

import type { CommandContext } from '@cardstack/runtime-common';
import {
  type Permissions,
  type getCard,
  type getCards,
  type getCardCollection,
  cardTypeDisplayName,
  PermissionsContextName,
  RealmURLContextName,
  GetCardContextName,
  GetCardsContextName,
  GetCardCollectionContextName,
  cardTypeIcon,
  realmURL,
  localId as localIdSymbol,
  CardContextName,
  CardCrudFunctionsContextName,
  getMenuItems,
} from '@cardstack/runtime-common';

import type { StackItem } from '@cardstack/host/lib/stack-item';
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
    this.cardResource = this.getCard(this, () => this.args.item.id);
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
      transition: margin-top var(--boxel-transition), width var(--boxel-transition);
    `; // using margin-top instead of padding-top to hide scrolled content from view

    return htmlSafe(styles);
  }

  private get isBuried() {
    return this.args.index + 1 < this.args.stackItems.length;
  }

  private get isTopCard() {
    return !this.isBuried;
  }

  private get isIndexCard() {
    if (!this.realmURL) {
      return false;
    }
    return this.url === `${this.realmURL.href}index`;
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

  private _closeItem = dropTask(async () => {
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

    const menuItems: (MenuItem | { type: 'divider' })[] = [];

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

    // Add divider before delete action
    menuItems.push({ type: 'divider' });

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

    return toMenuItems(
      this.card?.[getMenuItems]?.({
        canEdit: this.url ? this.realm.canWrite(this.url as string) : false,
        cardCrudFunctions: this.cardCrudFunctions,
        menuContext: 'interact',
        commandContext: this.args.commandContext,
      }) ?? [],
    );
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
    this.operatorModeStateService.replaceItemInStack(
      item,
      item.clone({
        request,
        format: 'isolated',
      }),
    );
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
      this.realm.canWrite(this.card[realmURL].href)
    );
  }

  private get isEditing() {
    return !this.isBuried && this.args.item.format === 'edit';
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
      class='item
        {{if this.isBuried "buried"}}
        {{if this.doOpeningAnimation "opening-animation"}}
        {{if this.doClosingAnimation "closing-animation"}}
        {{if this.doMovingForwardAnimation "move-forward-animation"}}
        {{if this.isTesting "testing"}}'
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
              @onFinishEditing={{if this.isEditing this.doneEditing}}
              @onClose={{unless this.isBuried this.closeItem}}
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
          {{/let}}
          <div
            class='stack-item-content'
            {{ContentElement onSetup=this.setupContentEl}}
            data-test-stack-item-content
          >
            <CardRenderer
              class='stack-item-preview'
              @card={{this.card}}
              @format={{@item.format}}
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
      }
      .item.opening-animation {
        animation: scaleIn 0.2s forwards;
        transition: margin-top var(--boxel-transition);
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
        --boxel-card-header-background-color: var(--boxel-light);
        border-radius: 0;
        z-index: 1;
        max-width: max-content;
        height: var(--stack-item-header-height);
        min-width: 100%;
        gap: var(--boxel-sp-xxs);
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
