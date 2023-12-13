import { registerDestructor } from '@ember/destroyable';
import { fn, array } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { schedule } from '@ember/runloop';
import { service } from '@ember/service';
import { htmlSafe, SafeString } from '@ember/template';
import Component from '@glimmer/component';

//@ts-expect-error cached type not available yet
import { tracked, cached } from '@glimmer/tracking';

import { formatDistanceToNow } from 'date-fns';
import {
  task,
  restartableTask,
  timeout,
  waitForProperty,
} from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import Modifier from 'ember-modifier';
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
import { cn, eq, menuItem, optional, not } from '@cardstack/boxel-ui/helpers';

import {
  type Actions,
  cardTypeDisplayName,
  Deferred,
} from '@cardstack/runtime-common';

import RealmIcon from '@cardstack/host/components/operator-mode/realm-icon';

import config from '@cardstack/host/config/environment';

import type {
  CardDef,
  Format,
  FieldType,
} from 'https://cardstack.com/base/card-api';

import ElementTracker from '../../resources/element-tracker';
import Preview from '../preview';

import { type StackItem } from '@cardstack/host/lib/stack-item';

import OperatorModeOverlays from './overlays';

import type CardService from '../../services/card-service';
import type EnvironmentService from '@cardstack/host/services/environment-service';
import {
  IconPencil,
  IconX,
  IconTrash,
  IconLink,
  ThreeDotsHorizontal,
} from '@cardstack/boxel-ui/icons';

interface Signature {
  Args: {
    item: StackItem;
    stackItems: StackItem[];
    index: number;
    publicAPI: Actions;
    close: (item: StackItem) => void;
    dismissStackedCardsAbove: (stackIndex: number) => void;
    edit: (item: StackItem) => void;
    save: (item: StackItem, dismiss: boolean) => void;
    delete: (card: CardDef) => void;
    onSelectedCards: (selectedCards: CardDef[], stackItem: StackItem) => void;
    setupStackItem: (
      stackItem: StackItem,
      clearSelections: () => void,
      doWithStableScroll: (changeSizeCallback: () => Promise<void>) => void,
      doScrollIntoView: (selector: string) => void,
    ) => void;
  };
}

export interface RenderedCardForOverlayActions {
  element: HTMLElement;
  card: CardDef;
  fieldType: FieldType | undefined;
  fieldName: string | undefined;
  format: Format | 'data';
  stackItem: StackItem;
}

export default class OperatorModeStackItem extends Component<Signature> {
  @service declare cardService: CardService;
  @service declare environmentService: EnvironmentService;
  @tracked selectedCards = new TrackedArray<CardDef>([]);
  @tracked isHoverOnRealmIcon = false;
  @tracked isSaving = false;
  @tracked lastSaved: number | undefined;
  @tracked lastSavedMsg: string | undefined;
  private refreshSaveMsg: number | undefined;
  private subscribedCard: CardDef | undefined;
  private contentEl: HTMLElement | undefined;
  private containerEl: HTMLElement | undefined;

  cardTracker = new ElementTracker<{
    card: CardDef;
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
    );
  }

  get renderedCardsForOverlayActions(): RenderedCardForOverlayActions[] {
    return (
      this.cardTracker.elements
        .filter((entry) => {
          return (
            entry.meta.format === 'data' ||
            entry.meta.fieldType === 'linksTo' ||
            entry.meta.fieldType === 'linksToMany'
          );
        })
        // this mapping could probably be eliminated or simplified if we refactor OperatorModeOverlays to accept our type
        .map((entry) => ({
          element: entry.element,
          card: entry.meta.card,
          fieldType: entry.meta.fieldType,
          fieldName: entry.meta.fieldName,
          format: entry.meta.format,
          stackItem: this.args.item,
        }))
    );
  }

  get styleForStackedCard(): SafeString {
    let itemsOnStackCount = this.args.stackItems.length;
    let invertedIndex = itemsOnStackCount - this.args.index - 1;
    let widthReductionPercent = 5; // Every new card on the stack is 5% wider than the previous one
    let offsetPx = 40; // Every new card on the stack is 40px lower than the previous one

    return htmlSafe(`
      width: ${100 - invertedIndex * widthReductionPercent}%;
      z-index: ${itemsOnStackCount - invertedIndex};
      margin-top: calc(${offsetPx}px * ${this.args.index});
    `); // using margin-top instead of padding-top to hide scrolled content from view
  }

  get isBuried() {
    return this.args.index + 1 < this.args.stackItems.length;
  }

  get context() {
    return {
      renderedIn: this as Component<any>,
      cardComponentModifier: this.cardTracker.trackElement,
      actions: this.args.publicAPI,
    };
  }

  @action toggleSelect(card: CardDef) {
    let index = this.selectedCards.findIndex((c) => c === card);

    if (index === -1) {
      this.selectedCards.push(card);
    } else {
      this.selectedCards.splice(index, 1);
    }

    // pass a copy of the array so that this doesn't become a
    // back door into mutating the state of this component
    this.args.onSelectedCards([...this.selectedCards], this.args.item);
  }

  copyToClipboard = restartableTask(async () => {
    if (!this.card.id) {
      return;
    }
    if (config.environment === 'test') {
      return; // navigator.clipboard is not available in test environment
    }
    await navigator.clipboard.writeText(this.card.id);
  });

  fetchRealmInfo = trackedFunction(
    this,
    async () => await this.cardService.getRealmInfo(this.card),
  );

  clearSelections = () => {
    this.selectedCards.splice(0, this.selectedCards.length);
  };

  @cached
  get iconURL() {
    return this.fetchRealmInfo.value?.iconURL;
  }

  get realmName() {
    return this.fetchRealmInfo.value?.name;
  }

  get cardIdentifier() {
    return this.args.item.url?.href;
  }

  @action
  hoverOnRealmIcon() {
    this.isHoverOnRealmIcon = !this.isHoverOnRealmIcon;
  }

  get headerIcon() {
    return {
      URL: this.iconURL,
      onMouseEnter: this.hoverOnRealmIcon,
      onMouseLeave: this.hoverOnRealmIcon,
    };
  }

  get headerTitle() {
    return this.isHoverOnRealmIcon && this.realmName
      ? `In ${this.realmName}`
      : cardTypeDisplayName(this.card);
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
    await timeout(this.environmentService.autoSaveDelayMs);
    this.isSaving = true;
    this.args.save(this.args.item, false);
    this.isSaving = false;
    this.lastSaved = Date.now();
    this.calculateLastSavedMsg();
  });

  private calculateLastSavedMsg() {
    this.lastSavedMsg =
      this.lastSaved != null
        ? `Saved ${formatDistanceToNow(this.lastSaved, { addSuffix: true })}`
        : undefined;
  }

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

  private setupContentEl = (el: HTMLElement) => {
    this.contentEl = el;
  };

  private setupContainerEl = (el: HTMLElement) => {
    this.containerEl = el;
  };

  <template>
    <div
      class='item {{if this.isBuried "buried"}}'
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
          <LoadingIndicator />
        {{else}}
          <Header
            @title={{this.headerTitle}}
            class={{cn 'header' header--icon-hovered=this.isHoverOnRealmIcon}}
            {{on
              'click'
              (optional
                (if this.isBuried (fn @dismissStackedCardsAbove @index))
              )
            }}
            data-test-stack-card-header
          >
            <:icon>
              {{#if this.headerIcon.URL}}
                <RealmIcon
                  @realmIconURL={{this.headerIcon.URL}}
                  @realmName={{this.realmName}}
                  class='header-icon'
                  data-test-boxel-header-icon={{this.headerIcon.URL}}
                  {{on 'mouseenter' this.headerIcon.onMouseEnter}}
                  {{on 'mouseleave' this.headerIcon.onMouseLeave}}
                />
              {{/if}}
            </:icon>
            <:actions>
              {{#if (eq @item.format 'isolated')}}
                <Tooltip @placement='top'>
                  <:trigger>
                    <IconButton
                      @icon={{IconPencil}}
                      @width='24px'
                      @height='24px'
                      class='icon-button'
                      aria-label='Edit'
                      {{on 'click' (fn @edit @item)}}
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
                      @width='24px'
                      @height='24px'
                      class='icon-save'
                      aria-label='Finish Editing'
                      {{on 'click' (fn @save @item true)}}
                      data-test-edit-button
                    />
                  </:trigger>
                  <:content>
                    Finish Editing
                  </:content>
                </Tooltip>
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
                      @items={{array
                        (menuItem
                          'Copy Card URL'
                          (perform this.copyToClipboard)
                          icon=IconLink
                          disabled=(not this.card.id)
                        )
                        (menuItem
                          'Delete'
                          (fn @delete this.card)
                          icon=IconTrash
                          dangerous=true
                          disabled=(not this.card.id)
                        )
                      }}
                    />
                  </:content>
                </BoxelDropdown>
              </div>
              <Tooltip @placement='top'>
                <:trigger>
                  <IconButton
                    @icon={{IconX}}
                    @width='20px'
                    @height='20px'
                    class='icon-button'
                    aria-label='Close'
                    {{on 'click' (fn @close @item)}}
                    data-test-close-button
                  />
                </:trigger>
                <:content>
                  Close
                </:content>
              </Tooltip>
            </:actions>
            <:detail>
              <div class='save-indicator'>
                {{#if this.isSaving}}
                  Saving…
                {{else if this.lastSavedMsg}}
                  {{this.lastSavedMsg}}
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
              @context={{this.context}}
            />
            <OperatorModeOverlays
              @renderedCardsForOverlayActions={{this.renderedCardsForOverlayActions}}
              @publicAPI={{@publicAPI}}
              @delete={{@delete}}
              @toggleSelect={{this.toggleSelect}}
              @selectedCards={{this.selectedCards}}
            />
          </div>
        {{/if}}
      </CardContainer>
    </div>
    <style>
      :global(:root) {
        --stack-card-footer-height: 6rem;
        --buried-operator-mode-header-height: 2.5rem;
      }

      .header {
        --boxel-header-icon-width: var(--boxel-icon-med);
        --boxel-header-icon-height: var(--boxel-icon-med);
        --boxel-header-padding: var(--boxel-sp-xs);
        --boxel-header-text-size: var(--boxel-font-med);

        z-index: 1;
        background-color: var(--boxel-light);
        max-width: max-content;
        min-width: 100%;
        gap: var(--boxel-sp-xxs);
      }

      .header-icon {
        border: 1px solid rgba(0, 0, 0, 0.15);
        border-radius: 7px;
      }

      .edit .header-icon {
        background: var(--boxel-light);
        border: 1px solid var(--boxel-light);
      }

      .header--icon-hovered {
        --boxel-header-text-color: var(--boxel-highlight);
        --boxel-header-text-size: var(--boxel-font);
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

      .card {
        position: relative;
        height: 100%;
        display: grid;
        grid-template-rows: 3.5rem auto;
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
        font: 700 var(--boxel-font);
        padding: 0 var(--boxel-sp-xs);
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

      .icon-button {
        --icon-color: var(--boxel-highlight);
        --boxel-icon-button-width: 28px;
        --boxel-icon-button-height: 28px;
        border-radius: 4px;

        display: flex;
        align-items: center;
        justify-content: center;

        font: var(--boxel-font-sm);
        margin-left: var(--boxel-sp-xxxs);
        z-index: 1;
      }

      .icon-button:hover {
        --icon-color: var(--boxel-light);
        background-color: var(--boxel-highlight);
      }

      .icon-save {
        --icon-color: var(--boxel-dark);
        background-color: var(--boxel-light);

        --boxel-icon-button-width: 28px;
        --boxel-icon-button-height: 28px;
        border-radius: 4px;

        display: flex;
        align-items: center;
        justify-content: center;

        font: var(--boxel-font-sm);
        z-index: 1;
      }

      .icon-save:hover {
        --icon-color: var(--boxel-highlight);
      }

      .header-icon {
        width: var(--boxel-header-icon-width);
        height: var(--boxel-header-icon-height);
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
