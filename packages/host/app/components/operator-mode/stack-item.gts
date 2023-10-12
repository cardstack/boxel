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
import { task, restartableTask, timeout } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import Modifier from 'ember-modifier';
import { trackedFunction } from 'ember-resources/util/function';

import { TrackedArray } from 'tracked-built-ins';

import CardContainer from '@cardstack/boxel-ui/components/card-container';
import Tooltip from '@cardstack/boxel-ui/components/tooltip';
import IconButton from '@cardstack/boxel-ui/components/icon-button';
import Header from '@cardstack/boxel-ui/components/header';
import BoxelDropdown from '@cardstack/boxel-ui/components/dropdown';
import BoxelMenu from '@cardstack/boxel-ui/components/menu';
import cn from '@cardstack/boxel-ui/helpers/cn';
import menuItem from '@cardstack/boxel-ui/helpers/menu-item';
import optional from '@cardstack/boxel-ui/helpers/optional';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';

import { type Actions, cardTypeDisplayName } from '@cardstack/runtime-common';

import RealmIcon from '@cardstack/host/components/operator-mode/realm-icon';

import config from '@cardstack/host/config/environment';

import type {
  CardDef,
  Format,
  FieldType,
} from 'https://cardstack.com/base/card-api';

import ElementTracker from '../../resources/element-tracker';
import Preview from '../preview';

import { type StackItem } from './container';

import OperatorModeOverlays from './overlays';

import type CardService from '../../services/card-service';
import ThreeDotsHorizontal from '@cardstack/boxel-ui/icons/three-dots-horizontal';
import IconPencil from '@cardstack/boxel-ui/icons/icon-pencil';
import IconX from '@cardstack/boxel-ui/icons/icon-x';
import IconTrash from '@cardstack/boxel-ui/icons/icon-trash';
import IconLink from '@cardstack/boxel-ui/icons/icon-link';

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
    ) => void;
  };
}

let { autoSaveDelayMs } = config;

export interface RenderedCardForOverlayActions {
  element: HTMLElement;
  card: CardDef;
  fieldType: FieldType | undefined;
  fieldName: string | undefined;
  stackItem: StackItem;
}

export default class OperatorModeStackItem extends Component<Signature> {
  @tracked selectedCards = new TrackedArray<CardDef>([]);
  @service declare cardService: CardService;
  @tracked isHoverOnRealmIcon = false;
  @tracked isSaving = false;
  @tracked lastSaved: number | undefined;
  @tracked lastSavedMsg: string | undefined;
  private refreshSaveMsg: number | undefined;
  private subscribedCard: CardDef;
  private contentEl: HTMLElement | undefined;

  cardTracker = new ElementTracker<{
    card: CardDef;
    format: Format | 'data';
    fieldType: FieldType | undefined;
    fieldName: string | undefined;
  }>();

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.subscribeToCard.perform();
    this.subscribedCard = this.card;
    this.args.setupStackItem(
      this.args.item,
      this.clearSelections,
      this.doWithStableScroll.perform,
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
    return this.args.item.card.id;
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

  private subscribeToCard = task(async () => {
    await this.cardService.ready;
    registerDestructor(this, this.cleanup);
    this.cardService.subscribe(this.subscribedCard, this.onCardChange);
    this.refreshSaveMsg = setInterval(
      () => this.calculateLastSavedMsg(),
      10 * 1000,
    ) as unknown as number;
  });

  private cleanup = () => {
    this.cardService.unsubscribe(this.subscribedCard, this.onCardChange);
    clearInterval(this.refreshSaveMsg);
  };

  private onCardChange = () => {
    this.doWhenCardChanges.perform();
  };

  private doWhenCardChanges = restartableTask(async () => {
    await timeout(autoSaveDelayMs);
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
      let el = this.contentEl;
      let currentScrollTop = this.contentEl.scrollTop;
      await changeSizeCallback();
      await this.cardService.cardsSettled();
      schedule('afterRender', () => {
        el.scrollTop = currentScrollTop;
      });
    },
  );

  private setupContentEl = (el: HTMLElement) => {
    this.contentEl = el;
  };

  <template>
    <div
      class='item {{if this.isBuried "buried"}}'
      data-test-stack-card-index={{@index}}
      data-test-stack-card={{this.cardIdentifier}}
      style={{this.styleForStackedCard}}
    >
      <CardContainer class={{cn 'card' edit=(eq @item.format 'edit')}}>
        <Header
          @title={{this.headerTitle}}
          class={{cn 'header' header--icon-hovered=this.isHoverOnRealmIcon}}
          {{on
            'click'
            (optional (if this.isBuried (fn @dismissStackedCardsAbove @index)))
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
                    @items={{if
                      (eq @item.format 'edit')
                      (array
                        (menuItem
                          'Copy Card URL'
                          (perform this.copyToClipboard)
                          icon=IconLink
                        )
                        (menuItem
                          'Delete'
                          (fn @delete this.card)
                          icon=IconTrash
                          dangerous=true
                        )
                      )
                      (array
                        (menuItem
                          'Copy Card URL'
                          (perform this.copyToClipboard)
                          icon=IconLink
                        )
                        (menuItem
                          'Delete'
                          (fn @delete this.card)
                          icon=IconTrash
                          dangerous=true
                        )
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
                {{if (eq @item.format 'isolated') 'Close' 'Cancel & Close'}}
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
        <div class='content' {{ContentElement onSetup=this.setupContentEl}}>
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

      .edit .content {
        margin-bottom: var(--stack-card-footer-height);
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

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    OperatorModeStackItem: typeof OperatorModeStackItem;
  }
}
