import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { schedule, scheduleOnce } from '@ember/runloop';
import { service } from '@ember/service';
import { htmlSafe, SafeString } from '@ember/template';

import { isTesting } from '@embroider/macros';

import Component from '@glimmer/component';

import { tracked, cached } from '@glimmer/tracking';

import {
  restartableTask,
  timeout,
  waitForProperty,
  dropTask,
} from 'ember-concurrency';
import Modifier from 'ember-modifier';
import { provide, consume } from 'ember-provide-consume-context';

import { TrackedArray } from 'tracked-built-ins';

import {
  CardContainer,
  CardHeader,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { MenuItem, getContrastColor } from '@cardstack/boxel-ui/helpers';
import { cssVar, optional, not } from '@cardstack/boxel-ui/helpers';

import { IconTrash, IconLink } from '@cardstack/boxel-ui/icons';

import {
  type Actions,
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
  Deferred,
  cardTypeIcon,
  CommandContext,
  realmURL,
} from '@cardstack/runtime-common';

import { type StackItem } from '@cardstack/host/lib/stack-item';
import { urlForRealmLookup } from '@cardstack/host/lib/utils';

import type { CardContext, CardDef } from 'https://cardstack.com/base/card-api';

import consumeContext from '../../helpers/consume-context';
import ElementTracker, {
  type RenderedCardForOverlayActions,
} from '../../resources/element-tracker';
import Preview from '../preview';

import CardError from './card-error';

import OperatorModeOverlays from './operator-mode-overlays';

import type CardService from '../../services/card-service';
import type EnvironmentService from '../../services/environment-service';
import type LoaderService from '../../services/loader-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import type RealmService from '../../services/realm';
import type StoreService from '../../services/store';

export interface StackItemComponentAPI {
  clearSelections: () => void;
  doWithStableScroll: (
    changeSizeCallback: () => Promise<void>,
  ) => Promise<void>;
  scrollIntoView: (selector: string) => Promise<void>;
  startAnimation: (type: 'closing' | 'movingForward') => Promise<void>;
}

interface Signature {
  Args: {
    item: StackItem;
    stackItems: StackItem[];
    index: number;
    publicAPI: Actions;
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

export interface StackItemRenderedCardForOverlayActions
  extends RenderedCardForOverlayActions {
  stackItem: StackItem;
}

type StackItemCardContext = Omit<CardContext, 'prerenderedCardSearchComponent'>;

export default class OperatorModeStackItem extends Component<Signature> {
  @consume(GetCardContextName) private declare getCard: getCard;
  @consume(GetCardsContextName) private declare getCards: getCards;
  @consume(GetCardCollectionContextName)
  private declare getCardCollection: getCardCollection;

  @service private declare cardService: CardService;
  @service private declare environmentService: EnvironmentService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare realm: RealmService;
  @service private declare loaderService: LoaderService;
  @service private declare store: StoreService;

  @tracked private selectedCards = new TrackedArray<CardDefOrId>([]);
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
      doWithStableScroll: this.doWithStableScroll.perform,
      scrollIntoView: this.scrollIntoView.perform,
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
    const stackItemMaxWidth = '50rem';
    const widthReductionPercent = 5; // Every new card on the stack is 5% wider than the previous one
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
        marginTopPx = numberOfCards === 2 ? 25 : 50;
      } else if (isSecondLastCard && numberOfCards > 2) {
        marginTopPx = 25;
      }
    }

    let maxWidthPercent = 100 - invertedIndex * widthReductionPercent;
    let width = this.isItemFullWidth
      ? '100%'
      : `calc(${stackItemMaxWidth} * ${maxWidthPercent} / 100)`;

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

  private get cardContext(): StackItemCardContext {
    return {
      cardComponentModifier: this.cardTracker.trackElement,
      actions: this.args.publicAPI,
      commandContext: this.args.commandContext,
      getCard: this.getCard,
      getCards: this.getCards,
      getCardCollection: this.getCardCollection,
      store: this.store,
    };
  }

  private closeItem = () => this._closeItem.perform();

  private _closeItem = dropTask(async () => {
    await this.args.dismissStackedCardsAbove(this.args.index - 1);
  });

  @action private toggleSelect(cardDefOrId: CardDefOrId) {
    let index = this.selectedCards.findIndex((c) => c === cardDefOrId);

    if (index === -1) {
      this.selectedCards.push(cardDefOrId);
    } else {
      this.selectedCards.splice(index, 1);
    }

    // pass a copy of the array so that this doesn't become a
    // back door into mutating the state of this component
    this.args.onSelectedCards([...this.selectedCards], this.args.item);
  }

  private clearSelections = () => {
    this.selectedCards.splice(0, this.selectedCards.length);
  };

  private get cardIdentifier() {
    return this.url;
  }

  private get headerTitle() {
    return this.card ? cardTypeDisplayName(this.card) : undefined;
  }

  private get cardTitle() {
    return this.card ? this.card.title : undefined;
  }

  private get moreOptionsMenuItemsForErrorCard() {
    if (this.isBuried) {
      return undefined;
    }
    return [
      new MenuItem('Delete Card', 'action', {
        action: () =>
          this.cardIdentifier &&
          this.args.publicAPI.delete(this.cardIdentifier),
        icon: IconTrash,
        dangerous: true,
      }),
    ];
  }

  private get moreOptionsMenuItems() {
    if (this.isBuried) {
      return undefined;
    }
    let menuItems: MenuItem[] = [
      new MenuItem('Copy Card URL', 'action', {
        action: () =>
          this.card
            ? this.args.publicAPI.copyURLToClipboard(this.card)
            : undefined,
        icon: IconLink,
        disabled: !this.url,
      }),
    ];
    if (
      !this.isIndexCard && // workspace index card cannot be deleted
      this.url &&
      this.realm.canWrite(this.url)
    ) {
      menuItems.push(
        new MenuItem('Delete', 'action', {
          action: () =>
            this.card ? this.args.publicAPI.delete(this.card) : undefined,
          icon: IconTrash,
          dangerous: true,
          disabled: !this.url,
        }),
      );
    }
    return menuItems;
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
    // if the card is actually different do the save and dismiss, otherwise
    // just change the stack item's format to isolated
    if (this.card && this.cardResource?.autoSaveState?.hasUnsavedChanges) {
      // we dont want to have the user wait for the save to complete before
      // dismissing edit mode so intentionally not awaiting here
      request?.fulfill(this.card.id);
      this.store.save(this.card.id);
    }
    this.operatorModeStateService.replaceItemInStack(
      item,
      item.clone({
        request,
        format: 'isolated',
      }),
    );
  };

  private doWithStableScroll = restartableTask(
    async (changeSizeCallback: () => Promise<void>) => {
      if (!this.contentEl) {
        return;
      }
      let deferred = new Deferred<void>();
      let el = this.contentEl;
      let currentScrollTop = this.contentEl.scrollTop;
      await changeSizeCallback();
      await this.cardService.cardsSettled();
      schedule('afterRender', () => {
        el.scrollTop = currentScrollTop;
        deferred.fulfill();
      });
      await deferred.promise;
    },
  );

  private scrollIntoView = restartableTask(async (selector: string) => {
    if (!this.contentEl || !this.containerEl) {
      return;
    }
    // this has the effect of waiting for a search to complete
    // in the scenario the stack item is a cards-grid
    await waitForProperty(this.doWithStableScroll, 'isIdle', true);
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
      if (!this.itemEl) return;
      await new Promise<void>((resolve) => {
        scheduleOnce(
          'afterRender',
          this,
          this.handleAnimationCompletion,
          resolve,
        );
      });
    },
  );

  private handleAnimationCompletion(resolve: () => void) {
    if (!this.itemEl) {
      return;
    }
    const animations = this.itemEl.getAnimations() || [];
    Promise.all(animations.map((animation) => animation.finished))
      .then(() => {
        this.animationType = undefined;
        resolve();
      })
      .catch((e) => {
        // AbortError is expected in two scenarios:
        // 1. Multiple stack items are animating in parallel (eg. closing and moving forward)
        //    and some elements get removed before their animations complete
        // 2. Tests running with animation-duration: 0s can cause
        //    animations to abort before they're properly tracked
        if (e.name === 'AbortError') {
          this.animationType = undefined;
          resolve();
        } else {
          console.error(e);
        }
      });
  }

  private setupContentEl = (el: HTMLElement) => {
    this.contentEl = el;
  };

  private setupContainerEl = (el: HTMLElement) => {
    this.containerEl = el;
  };

  private get canEdit() {
    return (
      this.card &&
      !this.isBuried &&
      !this.isEditing &&
      this.realm.canWrite(this.card.id)
    );
  }

  private get isEditing() {
    return !this.isBuried && this.args.item.format === 'edit';
  }

  private setupItemEl = (el: HTMLElement) => {
    this.itemEl = el;
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
        {{ContentElement onSetup=this.setupContainerEl}}
      >
        {{#if (not this.cardResource.isLoaded)}}
          <div class='loading' data-test-stack-item-loading-card>
            <LoadingIndicator @color='var(--boxel-dark)' />
            <span class='loading__message'>Loading card...</span>
          </div>
        {{else if this.cardError}}
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
        {{else if this.card}}
          {{this.setWindowTitle}}
          {{#let (this.realm.info this.urlForRealmLookup) as |realmInfo|}}
            <CardHeader
              @cardTypeDisplayName={{this.headerTitle}}
              @cardTypeIcon={{cardTypeIcon this.card}}
              @isSaving={{this.cardResource.autoSaveState.isSaving}}
              @isTopCard={{this.isTopCard}}
              @lastSavedMessage={{this.cardResource.autoSaveState.lastSavedErrorMsg}}
              @moreOptionsMenuItems={{this.moreOptionsMenuItems}}
              @realmInfo={{realmInfo}}
              @onEdit={{if this.canEdit (fn @publicAPI.editCard this.card)}}
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
            <Preview
              class='stack-item-preview'
              @card={{this.card}}
              @format={{@item.format}}
              @cardContext={{this.cardContext}}
            />
            <OperatorModeOverlays
              @renderedCardsForOverlayActions={{this.renderedCardsForOverlayActions}}
              @publicAPI={{@publicAPI}}
              @toggleSelect={{this.toggleSelect}}
              @selectedCards={{this.selectedCards}}
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
