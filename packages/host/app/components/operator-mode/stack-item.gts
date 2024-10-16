import { registerDestructor } from '@ember/destroyable';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { schedule } from '@ember/runloop';
import { service } from '@ember/service';
import { htmlSafe, SafeString } from '@ember/template';

import { isTesting } from '@embroider/macros';

import Component from '@glimmer/component';

import { tracked, cached } from '@glimmer/tracking';

import { formatDistanceToNow } from 'date-fns';
import {
  task,
  restartableTask,
  timeout,
  waitForProperty,
  dropTask,
} from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import Modifier from 'ember-modifier';
import { provide } from 'ember-provide-consume-context';
import { trackedFunction } from 'ember-resources/util/function';

import { TrackedArray } from 'tracked-built-ins';

import {
  BoxelDropdown,
  Menu as BoxelMenu,
  CardContainer,
  Header,
  IconButton,
  Tooltip,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { MenuItem } from '@cardstack/boxel-ui/helpers';
import {
  cn,
  cssVar,
  eq,
  optional,
  getContrastColor,
} from '@cardstack/boxel-ui/helpers';

import {
  IconPencil,
  IconX,
  IconTrash,
  IconLink,
  ThreeDotsHorizontal,
} from '@cardstack/boxel-ui/icons';

import {
  type Actions,
  cardTypeDisplayName,
  PermissionsContextName,
  type Permissions,
  Deferred,
} from '@cardstack/runtime-common';

import RealmIcon from '@cardstack/host/components/operator-mode/realm-icon';

import config from '@cardstack/host/config/environment';

import { type StackItem } from '@cardstack/host/lib/stack-item';

import type {
  CardDef,
  Format,
  FieldType,
} from 'https://cardstack.com/base/card-api';

import ElementTracker from '../../resources/element-tracker';
import Preview from '../preview';

import OperatorModeOverlays from './overlays';

import type CardService from '../../services/card-service';
import type EnvironmentService from '../../services/environment-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import type RealmService from '../../services/realm';

interface Signature {
  Args: {
    item: StackItem;
    stackItems: StackItem[];
    index: number;
    publicAPI: Actions;
    close: (item: StackItem) => void;
    dismissStackedCardsAbove: (stackIndex: number) => void;
    onSelectedCards: (
      selectedCards: CardDefOrId[],
      stackItem: StackItem,
    ) => void;
    setupStackItem: (
      stackItem: StackItem,
      clearSelections: () => void,
      doWithStableScroll: (changeSizeCallback: () => Promise<void>) => void,
      doScrollIntoView: (selector: string) => void,
      doCloseAnimation: () => void,
    ) => void;
  };
}

export type CardDefOrId = CardDef | string;

export interface RenderedCardForOverlayActions {
  element: HTMLElement;
  cardDefOrId: CardDefOrId;
  fieldType: FieldType | undefined;
  fieldName: string | undefined;
  format: Format | 'data';
  stackItem: StackItem;
  overlayZIndexStyle?: SafeString;
}

export default class OperatorModeStackItem extends Component<Signature> {
  @service private declare cardService: CardService;
  @service private declare environmentService: EnvironmentService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare realm: RealmService;

  // @tracked private selectedCards = new TrackedArray<CardDef>([]);
  @tracked private selectedCards = new TrackedArray<CardDefOrId>([]);
  @tracked private isHoverOnRealmIcon = false;
  @tracked private isSaving = false;
  @tracked private isClosing = false;
  @tracked private hasUnsavedChanges = false;
  @tracked private lastSaved: number | undefined;
  @tracked private lastSavedMsg: string | undefined;
  private refreshSaveMsg: number | undefined;
  private subscribedCard: CardDef | undefined;
  private contentEl: HTMLElement | undefined;
  private containerEl: HTMLElement | undefined;

  @provide(PermissionsContextName)
  get permissions(): Permissions {
    return this.realm.permissions(this.card.id);
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
    this.subscribeToCard.perform();
    this.args.setupStackItem(
      this.args.item,
      this.clearSelections,
      this.doWithStableScroll.perform,
      this.scrollIntoView.perform,
      this.doCloseAnimation.perform,
    );
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
        marginTopPx = numberOfCards === 2 ? 30 : 55;
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
      transition: margin-top var(--boxel-transition);
    `; // using margin-top instead of padding-top to hide scrolled content from view

    return htmlSafe(styles);
  }

  private get isBuried() {
    return this.args.index + 1 < this.args.stackItems.length;
  }

  private get isLastItem() {
    return this.args.index === this.args.stackItems.length - 1;
  }

  private get cardContext() {
    return {
      cardComponentModifier: this.cardTracker.trackElement,
      actions: this.args.publicAPI,
    };
  }

  private closeItem = dropTask(async () => {
    await this.doCloseAnimation.perform();
    this.args.close(this.args.item);
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

  private copyToClipboard = restartableTask(async () => {
    if (!this.card.id) {
      return;
    }
    if (config.environment === 'test') {
      return; // navigator.clipboard is not available in test environment
    }
    await navigator.clipboard.writeText(this.card.id);
  });

  private fetchRealmInfo = trackedFunction(
    this,
    async () => await this.cardService.getRealmInfo(this.card),
  );

  private clearSelections = () => {
    this.selectedCards.splice(0, this.selectedCards.length);
  };

  private get realmName() {
    return this.fetchRealmInfo.value?.name;
  }

  private get cardIdentifier() {
    return this.args.item.url?.href;
  }

  @action
  private hoverOnRealmIcon() {
    this.isHoverOnRealmIcon = !this.isHoverOnRealmIcon;
  }

  private get headerTitle() {
    return this.isHoverOnRealmIcon && this.realmName
      ? `In ${this.realmName}`
      : cardTypeDisplayName(this.card);
  }

  private get moreOptionsMenuItems() {
    let menuItems: MenuItem[] = [
      new MenuItem('Copy Card URL', 'action', {
        action: () => this.copyToClipboard.perform(),
        icon: IconLink,
        disabled: !this.card.id,
      }),
    ];
    if (this.realm.canWrite(this.card.id)) {
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

  private loadCard = restartableTask(async () => {
    await this.args.item.ready();
  });

  private subscribeToCard = task(async () => {
    await this.args.item.ready();
    this.subscribedCard = this.card;
    let api = this.args.item.api;
    registerDestructor(this, this.cleanup);
    api.subscribeToChanges(this.subscribedCard, this.onCardChange);
    this.refreshSaveMsg = setInterval(
      () => this.calculateLastSavedMsg(),
      10 * 1000,
    ) as unknown as number;
  });

  private cleanup = () => {
    if (this.subscribedCard) {
      let api = this.args.item.api;
      api.unsubscribeFromChanges(this.subscribedCard, this.onCardChange);
      clearInterval(this.refreshSaveMsg);
    }
  };

  private onCardChange = () => {
    this.initiateAutoSaveTask.perform();
  };

  private initiateAutoSaveTask = restartableTask(async () => {
    this.hasUnsavedChanges = true;
    await timeout(this.environmentService.autoSaveDelayMs);
    this.isSaving = true;
    await this.args.publicAPI.saveCard(this.card, false);
    this.hasUnsavedChanges = false;
    this.isSaving = false;
    this.lastSaved = Date.now();
    this.calculateLastSavedMsg();
  });

  private calculateLastSavedMsg() {
    // runs frequently, so only change a tracked property if the value has changed
    if (this.lastSaved == null) {
      if (this.lastSavedMsg) {
        this.lastSavedMsg = undefined;
      }
    } else {
      let savedMessage = `Saved ${formatDistanceToNow(this.lastSaved, {
        addSuffix: true,
      })}`;
      if (this.lastSavedMsg != savedMessage) {
        this.lastSavedMsg = savedMessage;
      }
    }
  }

  private doneEditing = restartableTask(async () => {
    // if the card is actually different do the save and dismiss, otherwise
    // just change the stack item's format to isolated
    if (this.hasUnsavedChanges) {
      // we dont want to have the user wait for the save to complete before
      // dismissing edit mode so intentionally not awaiting here
      this.args.publicAPI.saveCard(this.card, true);
    } else {
      let { request } = this.args.item;
      this.operatorModeStateService.replaceItemInStack(
        this.args.item,
        this.args.item.clone({
          request,
          format: 'isolated',
        }),
      );
    }
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

  private doCloseAnimation = dropTask(async () => {
    this.isClosing = true;
    if (!isTesting()) {
      // wait for the animation to complete
      await timeout(100);
    }
  });

  private setupContentEl = (el: HTMLElement) => {
    this.contentEl = el;
  };

  private setupContainerEl = (el: HTMLElement) => {
    this.containerEl = el;
  };

  private get doOpeningAnimation() {
    return !isTesting() && this.isLastItem;
  }

  private get doClosingAnimation() {
    return !isTesting() && this.isClosing;
  }

  <template>
    <div
      class='item
        {{if this.isBuried "buried"}}
        {{if this.doOpeningAnimation "opening-animation"}}
        {{if this.doClosingAnimation "closing-animation"}}'
      data-test-stack-card-index={{@index}}
      data-test-stack-card={{this.cardIdentifier}}
      {{! In order to support scrolling cards into view
      we use a selector that is not pruned out in production builds }}
      data-stack-card={{this.cardIdentifier}}
      style={{this.styleForStackedCard}}
    >
      <CardContainer
        class={{cn 'card' edit=(eq @item.format 'edit')}}
        {{ContentElement onSetup=this.setupContainerEl}}
      >
        {{#if this.loadCard.isRunning}}
          <div class='loading' data-test-stack-item-loading-card>
            <LoadingIndicator @color='var(--boxel-dark)' />
            <span class='loading__message'>Loading card...</span>
          </div>
        {{else}}
          <Header
            @size='large'
            @title={{this.headerTitle}}
            @hasBackground={{true}}
            class={{cn 'header' header--icon-hovered=this.isHoverOnRealmIcon}}
            style={{cssVar
              boxel-header-background-color=@item.headerColor
              boxel-header-text-color=(getContrastColor @item.headerColor)
            }}
            {{on
              'click'
              (optional
                (if this.isBuried (fn @dismissStackedCardsAbove @index))
              )
            }}
            data-test-stack-card-header
          >
            <:icon>
              {{#let (this.realm.info this.card.id) as |realmInfo|}}
                {{#if realmInfo.iconURL}}
                  <RealmIcon
                    @realmInfo={{realmInfo}}
                    class='header-icon'
                    style={{cssVar
                      realm-icon-background=(getContrastColor
                        @item.headerColor 'transparent'
                      )
                    }}
                    data-test-boxel-header-icon={{realmInfo.iconURL}}
                    {{on 'mouseenter' this.hoverOnRealmIcon}}
                    {{on 'mouseleave' this.hoverOnRealmIcon}}
                  />
                {{/if}}
              {{/let}}
            </:icon>
            <:actions>
              {{#if (this.realm.canWrite this.card.id)}}
                {{#if (eq @item.format 'isolated')}}
                  <Tooltip @placement='top'>
                    <:trigger>
                      <IconButton
                        @icon={{IconPencil}}
                        @width='20px'
                        @height='20px'
                        class='icon-button'
                        aria-label='Edit'
                        {{on 'click' (fn @publicAPI.editCard this.card)}}
                        data-test-edit-button
                      />
                    </:trigger>
                    <:content>
                      Edit
                    </:content>
                  </Tooltip>
                {{else}}
                  <Tooltip @placement='top'>
                    <:trigger>
                      <IconButton
                        @icon={{IconPencil}}
                        @width='20px'
                        @height='20px'
                        class='icon-save'
                        aria-label='Finish Editing'
                        {{on 'click' (perform this.doneEditing)}}
                        data-test-edit-button
                      />
                    </:trigger>
                    <:content>
                      Finish Editing
                    </:content>
                  </Tooltip>
                {{/if}}
              {{/if}}
              <div>
                <BoxelDropdown>
                  <:trigger as |bindings|>
                    <Tooltip @placement='top'>
                      <:trigger>
                        <IconButton
                          @icon={{ThreeDotsHorizontal}}
                          @width='20px'
                          @height='20px'
                          class='icon-button'
                          aria-label='Options'
                          data-test-more-options-button
                          {{bindings}}
                        />
                      </:trigger>
                      <:content>
                        More Options
                      </:content>
                    </Tooltip>
                  </:trigger>
                  <:content as |dd|>
                    <BoxelMenu
                      @closeMenu={{dd.close}}
                      @items={{this.moreOptionsMenuItems}}
                    />
                  </:content>
                </BoxelDropdown>
              </div>
              <Tooltip @placement='top'>
                <:trigger>
                  <IconButton
                    @icon={{IconX}}
                    @width='16px'
                    @height='16px'
                    class='icon-button'
                    aria-label='Close'
                    {{on 'click' (perform this.closeItem)}}
                    data-test-close-button
                  />
                </:trigger>
                <:content>
                  Close
                </:content>
              </Tooltip>
            </:actions>
            <:detail>
              <div class='save-indicator' data-test-auto-save-indicator>
                {{#if this.isSaving}}
                  Saving…
                {{else if this.lastSavedMsg}}
                  <div data-test-last-saved>
                    {{this.lastSavedMsg}}
                  </div>
                {{/if}}
              </div>
            </:detail>
          </Header>
          <div
            class='content'
            {{ContentElement onSetup=this.setupContentEl}}
            data-test-stack-item-content
          >
            <Preview
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
        --stack-item-header-area-height: 3.375rem;
        --buried-operator-mode-header-height: 2.5rem;
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

      .header {
        --boxel-header-icon-width: var(--boxel-icon-med);
        --boxel-header-icon-height: var(--boxel-icon-med);
        --boxel-header-padding: var(--boxel-sp-sm);
        --boxel-header-text-font: var(--boxel-font-med);
        --boxel-header-border-radius: var(--boxel-border-radius-xl);
        --boxel-header-background-color: var(--boxel-light);
        z-index: 1;
        max-width: max-content;
        height: fit-content;
        min-width: 100%;
        gap: var(--boxel-sp-xxs);
      }

      .header:not(.edit .header) {
        --boxel-header-detail-max-width: none;
      }

      .header-icon {
        background-color: var(--realm-icon-background);
        border: 1px solid rgba(0, 0, 0, 0.15);
        border-radius: 7px;
      }

      .edit .header-icon {
        background: var(--boxel-light);
        border: 1px solid var(--boxel-light);
      }

      .header--icon-hovered {
        --boxel-header-text-color: var(--boxel-highlight);
        --boxel-header-text-font: var(--boxel-font);
      }

      .save-indicator {
        font: var(--boxel-font-sm);
        padding-top: 0.4rem;
        padding-left: 0.5rem;
        opacity: 0.6;
      }

      .item {
        justify-self: center;
        position: absolute;
        width: 89%;
        height: inherit;
        z-index: 0;
        pointer-events: none;
      }
      .item.opening-animation {
        animation: scaleIn 0.2s forwards;
      }
      .item.closing-animation {
        animation: fadeOut 0.2s forwards;
      }

      .card {
        border-radius: var(--boxel-border-radius-xl);
        position: relative;
        height: 100%;
        display: grid;
        grid-template-rows: var(--stack-item-header-area-height) auto;
        box-shadow: var(--boxel-deep-box-shadow);
        pointer-events: auto;
      }

      .content {
        overflow: auto;
      }

      :global(.content > .boxel-card-container.boundaries) {
        box-shadow: none;
      }

      .card {
        overflow: hidden;
      }

      .buried .card {
        border-radius: var(--boxel-border-radius-lg);
        background-color: var(--boxel-200);
        grid-template-rows: var(--buried-operator-mode-header-height) auto;
      }

      .buried > .card > .content {
        display: none;
      }

      .buried .header .icon-button {
        display: none;
      }

      .buried .header {
        cursor: pointer;
        font: 600 var(--boxel-font);
        gap: var(--boxel-sp-xxxs);
        --boxel-header-padding: var(--boxel-sp-xs);
        --boxel-header-text-font: var(--boxel-font-size);
        --boxel-header-icon-width: var(--boxel-icon-sm);
        --boxel-header-icon-height: var(--boxel-icon-sm);
        --boxel-header-border-radius: var(--boxel-border-radius-lg);
      }

      .edit .header {
        background-color: var(--boxel-highlight);
        color: var(--boxel-light);
      }

      .edit .icon-button {
        --icon-color: var(--boxel-light);
      }

      .edit .icon-button:hover {
        --icon-color: var(--boxel-highlight);
        background-color: var(--boxel-light);
      }

      .icon-button,
      .icon-save {
        --boxel-icon-button-width: 26px;
        --boxel-icon-button-height: 26px;
        border-radius: 4px;

        display: flex;
        align-items: center;
        justify-content: center;
        font: var(--boxel-font-sm);
        z-index: 1;
      }

      .icon-button {
        --icon-color: var(--boxel-header-text-color, var(--boxel-highlight));
      }

      .icon-button:hover {
        --icon-color: var(--boxel-light);
        background-color: var(--boxel-highlight);
      }

      .icon-save {
        --icon-color: var(--boxel-dark);
        background-color: var(--boxel-light);
      }

      .icon-save:hover {
        --icon-color: var(--boxel-highlight);
      }

      .header-icon {
        width: var(--boxel-header-icon-width);
        height: var(--boxel-header-icon-height);
      }

      .loading {
        grid-area: 2;
        display: flex;
        justify-content: center;
        align-items: center;
        height: calc(100% - var(--stack-item-header-area-height));
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
