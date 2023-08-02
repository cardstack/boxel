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
  Button,
  Tooltip,
} from '@cardstack/boxel-ui';
import get from 'lodash/get';
import { type Actions, cardTypeDisplayName } from '@cardstack/runtime-common';

import { service } from '@ember/service';
//@ts-expect-error cached type not available yet
import { tracked, cached } from '@glimmer/tracking';
import { TrackedArray } from 'tracked-built-ins';

import BoxelDropdown from '@cardstack/boxel-ui/components/dropdown';
import BoxelMenu from '@cardstack/boxel-ui/components/menu';
import menuItem from '@cardstack/boxel-ui/helpers/menu-item';
import { StackItem, getCardStackItem, getPathToStackItem } from './container';

import { htmlSafe, SafeString } from '@ember/template';
import OperatorModeOverlays from './overlays';
import ElementTracker from '../../resources/element-tracker';
import config from '@cardstack/host/config/environment';
import cssVar from '@cardstack/boxel-ui/helpers/css-var';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';

interface Signature {
  Args: {
    item: StackItem;
    stackItems: StackItem[];
    index: number;
    publicAPI: Actions;
    cancel: (item: StackItem) => void;
    close: (item: StackItem) => void;
    delete: (item: StackItem) => void;
    dismissStackedCardsAbove: (stackIndex: number) => void;
    edit: (item: StackItem) => void;
    save: (item: StackItem) => void;
  };
}

export interface RenderedCardForOverlayActions {
  element: HTMLElement;
  card: Card;
  fieldType: FieldType | undefined;
  stackItem: StackItem;
}

export default class OperatorModeStackItem extends Component<Signature> {
  @tracked selectedCards = new TrackedArray<Card>([]);
  @service declare cardService: CardService;
  @tracked isHoverOnRealmIcon = false;

  cardTracker = new ElementTracker<{
    card: Card;
    format: Format | 'data';
    fieldType: FieldType | undefined;
  }>();

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
      padding-top: calc(${offsetPx}px * ${this.args.index});
    `);
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
  }

  @action async copyToClipboard(cardUrl: string) {
    if (!cardUrl) {
      return;
    }
    if (config.environment === 'test') {
      return; // navigator.clipboard is not available in test environment
    }
    await navigator.clipboard.writeText(cardUrl);
  }

  fetchRealmInfo = trackedFunction(this, async () => {
    let realmInfo = await this.cardService.getRealmInfo(this.card);
    return realmInfo;
  });

  get iconURL() {
    return this.fetchRealmInfo.value?.iconURL ?? '/default-realm-icon.png';
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
    return getCardStackItem(this.args.item, this.args.stackItems).card;
  }

  @cached
  get card(): Card {
    let path = getPathToStackItem(this.args.item, this.args.stackItems);
    if (path.length === 0) {
      return this.addressableCard;
    }
    return get(this.addressableCard, path.join('.'));
  }

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
                    {{on 'click' (fn @save @item)}}
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
                        @icon='icon-horizontal-three-dots'
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
                          (fn this.copyToClipboard this.card.id)
                          icon='icon-link'
                          disabled=(eq @item.type 'contained')
                        )
                        (menuItem
                          'Delete' (fn @delete @item @index) icon='icon-trash'
                        )
                      )
                      (array
                        (menuItem
                          'Copy Card URL'
                          (fn this.copyToClipboard this.card.id)
                          icon='icon-link'
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
        </Header>
        <div class='content'>
          <Preview
            @card={{this.card}}
            @format={{@item.format}}
            @context={{this.context}}
          />
          <OperatorModeOverlays
            @renderedCardsForOverlayActions={{this.renderedCardsForOverlayActions}}
            @publicAPI={{@publicAPI}}
            @toggleSelect={{this.toggleSelect}}
            @selectedCards={{this.selectedCards}}
          />
        </div>
        {{#if (eq @item.format 'edit')}}
          <footer class='footer'>
            <Button
              @kind='secondary-light'
              @size='tall'
              class='footer-button'
              {{on 'click' (fn @cancel @item)}}
              aria-label='Cancel'
              data-test-cancel-button
            >
              Cancel
            </Button>
            <Button
              @kind='primary'
              @size='tall'
              class='footer-button'
              {{on 'click' (fn @save @item)}}
              aria-label='Save'
              data-test-save-button
            >
              Save
            </Button>
          </footer>
        {{/if}}
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

      .item {
        justify-self: center;
        position: absolute;
        width: 89%;
        height: inherit;
        z-index: 0;
        overflow: hidden;
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

      .footer {
        position: absolute;
        bottom: 0;
        right: 0;
        display: flex;
        justify-content: flex-end;
        padding: var(--boxel-sp);
        width: 100%;
        background: white;
        height: var(--stack-card-footer-height);
        border-top: 1px solid var(--boxel-300);
        border-bottom-left-radius: var(--boxel-border-radius);
        border-bottom-right-radius: var(--boxel-border-radius);
      }

      .footer-button + .footer-button {
        margin-left: var(--boxel-sp-xs);
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
        background: var(--boxel-teal);
        color: var(--boxel-light);
      }

      .edit .icon-button {
        --icon-bg: var(--boxel-light);
        --icon-border: none;
        --icon-color: var(--boxel-light);
      }

      .edit .icon-button:hover {
        --icon-bg: var(--boxel-teal);
        --icon-border: none;
        --icon-color: var(--boxel-teal);
        background: var(--boxel-light);
      }

      .icon-button {
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
        --icon-bg: var(--boxel-light);
        --icon-border: none;
        --icon-color: var(--boxel-light);
        background: var(--boxel-teal);
      }

      .icon-save {
        --icon-bg: var(--boxel-teal);
        background: var(--boxel-light);

        --boxel-icon-button-width: 28px;
        --boxel-icon-button-height: 28px;
        border-radius: 4px;

        display: flex;
        align-items: center;
        justify-content: center;

        font: var(--boxel-font-sm);
        margin-right: var(--boxel-sp-xxxs);
        z-index: 1;
      }

      .icon-save:hover {
        --icon-bg: var(--boxel-dark);
      }

      .header-icon {
        width: var(--boxel-header-icon-width);
        height: var(--boxel-header-icon-height);
      }

    </style>
  </template>
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    OperatorModeStackItem: typeof OperatorModeStackItem;
  }
}
