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

import ExclamationCircle from '@cardstack/boxel-icons/exclamation-circle';
import {
  restartableTask,
  timeout,
  waitForProperty,
  dropTask,
} from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import Modifier from 'ember-modifier';
import { provide } from 'ember-provide-consume-context';

import { TrackedArray } from 'tracked-built-ins';

import {
  CardContainer,
  CardHeader,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { MenuItem, getContrastColor } from '@cardstack/boxel-ui/helpers';
import { cssVar, optional } from '@cardstack/boxel-ui/helpers';

import { IconTrash, IconLink } from '@cardstack/boxel-ui/icons';

import {
  type Actions,
  type Permissions,
  cardTypeDisplayName,
  PermissionsContextName,
  RealmURLContextName,
  Deferred,
  cardTypeIcon,
  CommandContext,
} from '@cardstack/runtime-common';

import { type StackItem, isIndexCard } from '@cardstack/host/lib/stack-item';

import type {
  CardContext,
  CardDef,
  Format,
  FieldType,
} from 'https://cardstack.com/base/card-api';

import { htmlComponent } from '../../lib/html-component';
import ElementTracker from '../../resources/element-tracker';
import Preview from '../preview';

import CardError from './card-error';
import CardErrorDetail from './card-error-detail';

import OperatorModeOverlays from './overlays';

import type CardService from '../../services/card-service';
import type EnvironmentService from '../../services/environment-service';
import type LoaderService from '../../services/loader-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import type RealmService from '../../services/realm';

import type { RenderedCardForOverlayActions } from './base-overlays';

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
    dismissStackedCardsAbove: (stackIndex: number) => void;
    onSelectedCards: (
      selectedCards: CardDefOrId[],
      stackItem: StackItem,
    ) => void;
    setupStackItem: (
      model: StackItem,
      componentAPI: StackItemComponentAPI,
    ) => void;
    saveCard: (card: CardDef) => Promise<CardDef | undefined>;
  };
}

export type CardDefOrId = CardDef | string;

export interface StackItemRenderedCardForOverlayActions
  extends RenderedCardForOverlayActions {
  stackItem: StackItem;
}

export default class OperatorModeStackItem extends Component<Signature> {
  @service private declare cardService: CardService;
  @service private declare environmentService: EnvironmentService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare realm: RealmService;
  @service private declare loaderService: LoaderService;

  // @tracked private selectedCards = new TrackedArray<CardDef>([]);
  @tracked private selectedCards = new TrackedArray<CardDefOrId>([]);
  @tracked private animationType:
    | 'opening'
    | 'closing'
    | 'movingForward'
    | undefined = 'opening';
  private contentEl: HTMLElement | undefined;
  private containerEl: HTMLElement | undefined;
  private itemEl: HTMLElement | undefined;

  @provide(PermissionsContextName)
  get permissions(): Permissions {
    return this.realm.permissions(this.card.id);
  }

  @provide(RealmURLContextName)
  get realmURL() {
    let api = this.args.item.api;
    return this.card[api.realmURL];
  }

  cardTracker = new ElementTracker<{
    cardId?: string;
    card?: CardDef;
    format: Format | 'data';
    fieldType: FieldType | undefined;
    fieldName: string | undefined;
  }>();

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.loadCard.perform();
    this.args.setupStackItem(this.args.item, {
      clearSelections: this.clearSelections,
      doWithStableScroll: this.doWithStableScroll.perform,
      scrollIntoView: this.scrollIntoView.perform,
      startAnimation: this.startAnimation.perform,
    });
  }

  private get renderedCardsForOverlayActions(): RenderedCardForOverlayActions[] {
    return this.cardTracker.elements
      .filter((entry) => {
        return (
          entry.meta.format === 'data' ||
          entry.meta.fieldType === 'linksTo' ||
          entry.meta.fieldType === 'linksToMany'
        );
      })
      .map((entry) => ({
        element: entry.element,
        cardDefOrId: entry.meta.card || entry.meta.cardId!,
        fieldType: entry.meta.fieldType,
        fieldName: entry.meta.fieldName,
        format: entry.meta.format,
        stackItem: this.args.item,
      }));
  }

  private get isItemFullWidth() {
    return !this.isBuried && this.args.item.isWideFormat;
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

  private get cardContext(): Omit<
    CardContext,
    'prerenderedCardSearchComponent'
  > {
    return {
      cardComponentModifier: this.cardTracker.trackElement,
      actions: this.args.publicAPI,
      commandContext: this.args.commandContext,
    };
  }

  private closeItem = dropTask(async () => {
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
    return this.args.item.url?.href;
  }

  private get headerTitle() {
    return cardTypeDisplayName(this.card);
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
        action: () => this.args.publicAPI.copyURLToClipboard(this.card),
        icon: IconLink,
        disabled: !this.card.id,
      }),
    ];
    if (
      !isIndexCard(this.args.item) && // workspace index card cannot be deleted
      this.realm.canWrite(this.card.id)
    ) {
      menuItems.push(
        new MenuItem('Delete', 'action', {
          action: () => this.args.publicAPI.delete(this.card),
          icon: IconTrash,
          dangerous: true,
          disabled: !this.card.id,
        }),
      );
    }
    return menuItems;
  }

  @cached
  get card(): CardDef {
    return this.args.item.card;
  }

  @cached
  get cardError() {
    return this.args.item.cardError;
  }

  @cached
  get lastKnownGoodHtml() {
    if (this.cardError?.meta.lastKnownGoodHtml) {
      this.loadScopedCSS.perform();
      return htmlComponent(this.cardError.meta.lastKnownGoodHtml);
    }
    return undefined;
  }

  @cached
  get cardErrorSummary() {
    if (!this.cardError) {
      return undefined;
    }
    return this.cardError.status === 404 &&
      // a missing link error looks a lot like a missing card error
      this.cardError.message?.includes('missing')
      ? `Link Not Found`
      : this.cardError.title;
  }

  get cardErrorTitle() {
    if (!this.cardError) {
      return undefined;
    }
    return `Card Error: ${this.cardErrorSummary}`;
  }

  private loadCard = restartableTask(async () => {
    await this.args.item.ready();
  });

  private loadScopedCSS = restartableTask(async () => {
    if (this.cardError?.meta.scopedCssUrls) {
      await Promise.all(
        this.cardError.meta.scopedCssUrls.map((cssModuleUrl) =>
          this.loaderService.loader.import(cssModuleUrl),
        ),
      );
    }
  });

  private doneEditing = restartableTask(async () => {
    let item = this.args.item;
    let { request } = item;
    // if the card is actually different do the save and dismiss, otherwise
    // just change the stack item's format to isolated
    if (item.autoSaveState?.hasUnsavedChanges) {
      // we dont want to have the user wait for the save to complete before
      // dismissing edit mode so intentionally not awaiting here
      let updatedCard = await this.args.saveCard(item.card);

      if (updatedCard) {
        request?.fulfill(updatedCard);
      }
    }
    this.operatorModeStateService.replaceItemInStack(
      item,
      item.clone({
        request,
        format: 'isolated',
      }),
    );
  });

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
      !this.isBuried && !this.isEditing && this.realm.canWrite(this.card.id)
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

  <template>
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
        {{#if this.loadCard.isRunning}}
          <div class='loading' data-test-stack-item-loading-card>
            <LoadingIndicator @color='var(--boxel-dark)' />
            <span class='loading__message'>Loading card...</span>
          </div>
        {{else if this.cardError}}
          <CardHeader
            @cardTypeDisplayName={{this.cardErrorTitle}}
            @cardTypeIcon={{ExclamationCircle}}
            @isTopCard={{this.isTopCard}}
            @moreOptionsMenuItems={{this.moreOptionsMenuItemsForErrorCard}}
            @onClose={{unless this.isBuried (perform this.closeItem)}}
            class='stack-item-header stack-item-header-error'
            style={{cssVar
              boxel-card-header-icon-container-min-width=(if
                this.isBuried '50px' '95px'
              )
              boxel-card-header-actions-min-width=(if
                this.isBuried '50px' '95px'
              )
              boxel-card-header-background-color=@item.headerColor
              boxel-card-header-text-color=(getContrastColor @item.headerColor)
              realm-icon-background-color=(getContrastColor
                @item.headerColor 'transparent'
              )
              realm-icon-border-color=(getContrastColor
                @item.headerColor 'transparent' 'rgba(0 0 0 / 15%)'
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
          <div class='stack-item-content card-error' data-test-card-error>
            {{#if this.lastKnownGoodHtml}}
              <this.lastKnownGoodHtml />
            {{else}}
              <CardError />
            {{/if}}
          </div>
          <CardErrorDetail
            @error={{this.cardError}}
            @title={{this.cardErrorSummary}}
            @viewInCodeMode={{true}}
          />
        {{else}}
          {{#let (this.realm.info this.card.id) as |realmInfo|}}
            <CardHeader
              @cardTypeDisplayName={{this.headerTitle}}
              @cardTypeIcon={{cardTypeIcon @item.card}}
              @isSaving={{@item.autoSaveState.isSaving}}
              @isTopCard={{this.isTopCard}}
              @lastSavedMessage={{@item.autoSaveState.lastSavedErrorMsg}}
              @moreOptionsMenuItems={{this.moreOptionsMenuItems}}
              @realmInfo={{realmInfo}}
              @onEdit={{if this.canEdit (fn @publicAPI.editCard this.card)}}
              @onFinishEditing={{if this.isEditing (perform this.doneEditing)}}
              @onClose={{unless this.isBuried (perform this.closeItem)}}
              class='stack-item-header'
              style={{cssVar
                boxel-card-header-icon-container-min-width=(if
                  this.isBuried '50px' '95px'
                )
                boxel-card-header-actions-min-width=(if
                  this.isBuried '50px' '95px'
                )
                boxel-card-header-background-color=@item.headerColor
                boxel-card-header-text-color=(getContrastColor
                  @item.headerColor
                )
                realm-icon-background-color=(getContrastColor
                  @item.headerColor 'transparent'
                )
                realm-icon-border-color=(getContrastColor
                  @item.headerColor 'transparent' 'rgba(0 0 0 / 15%)'
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
      .stack-item-header-error {
        color: var(--boxel-error-300);
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
      .card-error {
        flex: 2;
        opacity: 0.4;
        border-radius: 0;
        box-shadow: none;
        overflow: auto;
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
