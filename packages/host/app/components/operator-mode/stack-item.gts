import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type {
  Card,
  Format,
  FieldType,
} from 'https://cardstack.com/base/card-api';
import Preview from '../preview';
import { trackedFunction } from 'ember-resources/util/function';
import { fn, array } from '@ember/helper';
import type CardService from '../../services/card-service';

import { eq, and } from '@cardstack/boxel-ui/helpers/truth-helpers';
import optional from '@cardstack/boxel-ui/helpers/optional';
import cn from '@cardstack/boxel-ui/helpers/cn';
import {
  IconButton,
  Header,
  CardContainer,
  Tooltip,
} from '@cardstack/boxel-ui';
import get from 'lodash/get';
import { type Actions, cardTypeDisplayName } from '@cardstack/runtime-common';
import { task, restartableTask, timeout } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import { service } from '@ember/service';
//@ts-expect-error cached type not available yet
import { tracked, cached } from '@glimmer/tracking';
import { TrackedArray } from 'tracked-built-ins';

import BoxelDropdown from '@cardstack/boxel-ui/components/dropdown';
import BoxelMenu from '@cardstack/boxel-ui/components/menu';
import menuItem from '@cardstack/boxel-ui/helpers/menu-item';
import {
  type StackItem,
  getCardStackItem,
  getPathToStackItem,
} from './container';
import { registerDestructor } from '@ember/destroyable';

import { htmlSafe, SafeString } from '@ember/template';
import OperatorModeOverlays from './overlays';
import ElementTracker from '../../resources/element-tracker';
import config from '@cardstack/host/config/environment';
import cssVar from '@cardstack/boxel-ui/helpers/css-var';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import { formatDistanceToNow } from 'date-fns';
import Modifier from 'ember-modifier';
import { schedule } from '@ember/runloop';

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
    delete: (card: Card) => void;
    onSelectedCards: (selectedCards: Card[], stackItem: StackItem) => void;
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
  card: Card;
  fieldType: FieldType | undefined;
  fieldName: string | undefined;
  stackItem: StackItem;
}

export default class OperatorModeStackItem extends Component<Signature> {
  @tracked selectedCards = new TrackedArray<Card>([]);
  @service declare cardService: CardService;
  @tracked isHoverOnRealmIcon = false;
  @tracked isSaving = false;
  @tracked lastSaved: number | undefined;
  @tracked lastSavedMsg: string | undefined;
  private refreshSaveMsg: number | undefined;
  private subscribedCard: Card;
  private contentEl: HTMLElement | undefined;

  cardTracker = new ElementTracker<{
    card: Card;
    format: Format | 'data';
    fieldType: FieldType | undefined;
    fieldName: string | undefined;
  }>();

  constructor(owner: unknown, args: any) {
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
            entry.meta.fieldType === 'linksToMany' ||
            entry.meta.fieldType === 'contains'
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

  @action toggleSelect(card: Card) {
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
    let path = getPathToStackItem(this.args.item, this.args.stackItems);
    return `${this.addressableCard.id}${
      path.length > 0 ? '/' + path.join('/') : ''
    }`;
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
  get isContainedItem() {
    return this.args.item.type === 'contained';
  }

  @cached
  get addressableCard() {
    let card = getCardStackItem(this.args.item, this.args.stackItems).card;
    return card;
  }

  @cached
  get card(): Card {
    let path = getPathToStackItem(this.args.item, this.args.stackItems);
    if (path.length === 0) {
      return this.addressableCard;
    }
    return get(this.addressableCard, path.join('.'));
  }

  private subscribeToCard = task(async () => {
    await this.cardService.ready;
    registerDestructor(this, this.cleanup);
    this.cardService.subscribeToCard(this.subscribedCard, this.onCardChange);
    this.refreshSaveMsg = setInterval(
      () => this.calculateLastSavedMsg(),
      10 * 1000,
    ) as unknown as number;
  });

  private cleanup = () => {
    this.cardService.unsubscribeFromCard(
      this.subscribedCard,
      this.onCardChange,
    );
    clearInterval(this.refreshSaveMsg);
  };

  private onCardChange = () => {
    this.doWhenCardChanges.perform();
  };

  private doWhenCardChanges = restartableTask(async () => {
    await timeout(autoSaveDelayMs);
    this.isSaving = true;
    await this.args.save(this.args.item, false);
    this.isSaving = false;
    this.lastSaved = Date.now();
    this.calculateLastSavedMsg();
  });

  private calculateLastSavedMsg() {
    this.lastSavedMsg =
      this.lastSaved != null
        ? `Saved ${formatDistanceToNow(this.lastSaved)} ago`
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
          class='header'
          {{on
            'click'
            (optional (if this.isBuried (fn @dismissStackedCardsAbove @index)))
          }}
          style={{cssVar
            boxel-header-icon-width='30px'
            boxel-header-icon-height='30px'
            boxel-header-text-size=(if
              this.isHoverOnRealmIcon 'var(--boxel-font)' 'var(--boxel-font-lg)'
            )
            boxel-header-text-color=(if
              this.isHoverOnRealmIcon 'var(--boxel-teal)' 'var(--boxel-dark)'
            )
            boxel-header-padding='var(--boxel-sp-xs) var(--boxel-sp)'
            boxel-header-action-padding='var(--boxel-sp-xs) var(--boxel-sp)'
          }}
          data-test-stack-card-header
        >
          <:icon>
            {{#if this.isContainedItem}}
              {{svgJar 'icon-turn-down-right' width='22px' height='18px'}}
            {{else if this.headerIcon}}
              <img
                class='header-icon'
                src={{this.headerIcon.URL}}
                data-test-boxel-header-icon={{this.headerIcon.URL}}
                alt='Header icon'
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
                    @icon='icon-pencil'
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
                    @icon='icon-pencil'
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
                        @icon='three-dots-horizontal'
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
                      (and (eq @item.format 'edit') (eq @item.type 'card'))
                      (array
                        (menuItem
                          'Copy Card URL'
                          (perform this.copyToClipboard)
                          icon='icon-link'
                          disabled=(eq @item.type 'contained')
                        )
                        (menuItem
                          'Delete'
                          (fn @delete this.addressableCard)
                          icon='icon-trash'
                          disabled=(eq @item.type 'contained')
                        )
                      )
                      (array
                        (menuItem
                          'Copy Card URL'
                          (perform this.copyToClipboard)
                          icon='icon-link'
                          disabled=(eq @item.type 'contained')
                        )
                        (menuItem
                          'Delete'
                          (fn @delete this.addressableCard)
                          icon='icon-trash'
                          disabled=(eq @item.type 'contained')
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
                  @icon='icon-x'
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
        --stack-card-footer-height: 5rem;
        --buried-operator-mode-header-height: 2.5rem;
      }

      .header {
        z-index: 1;
        background: var(--boxel-light);
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
        box-shadow: 0 15px 30px 0 rgb(0 0 0 / 35%);
        pointer-events: auto;
      }

      .content {
        overflow: auto;
      }

      :global(.content > .boxel-card-container.boundaries) {
        box-shadow: none;
      }

      :global(.content > .boxel-card-container > header) {
        display: none;
      }

      .edit .content {
        margin-bottom: var(--stack-card-footer-height);
      }

      .buried .card {
        background-color: var(--boxel-200);
        grid-template-rows: var(--buried-operator-mode-header-height) auto;
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
