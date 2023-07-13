import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { Card, CardContext } from 'https://cardstack.com/base/card-api';
import Preview from '@cardstack/host/components/preview';
import { trackedFunction } from 'ember-resources/util/function';
import { fn, array } from '@ember/helper';
import type CardService from '@cardstack/host/services/card-service';

import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import optional from '@cardstack/boxel-ui/helpers/optional';
import cn from '@cardstack/boxel-ui/helpers/cn';
import { IconButton, Header, CardContainer, Button } from '@cardstack/boxel-ui';
import { type Actions, cardTypeDisplayName } from '@cardstack/runtime-common';

import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { TrackedArray } from 'tracked-built-ins';
import LinksToCardComponentModifier from '@cardstack/host/modifiers/links-to-card-component-modifier';
import { schedule } from '@ember/runloop';

import BoxelDropdown from '@cardstack/boxel-ui/components/dropdown';
import BoxelMenu from '@cardstack/boxel-ui/components/menu';
import menuItem from '@cardstack/boxel-ui/helpers/menu-item';
import { StackItem } from '@cardstack/host/components/operator-mode/container';

import { htmlSafe, SafeString } from '@ember/template';
import OperatorModeOverlays from '@cardstack/host/components/operator-mode/overlays';
import config from '@cardstack/host/config/environment';
import cssVar from '@cardstack/boxel-ui/helpers/css-var';

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

export interface RenderedLinksToCard {
  element: HTMLElement;
  card: Card;
  context: CardContext;
  stackedAtIndex: number;
}

export default class OperatorModeStackItem extends Component<Signature> {
  @tracked renderedLinksToCards = new TrackedArray<RenderedLinksToCard>([]);
  @tracked selectedCards = new TrackedArray<Card>([]);
  @service declare cardService: CardService;
  @tracked isHoverOnRealmIcon = false;

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
      cardComponentModifier: LinksToCardComponentModifier,
      actions: this.args.publicAPI,
    };
  }

  registerLinkedCardElement(
    linksToCardElement: HTMLElement,
    linksToCard: Card,
    context: CardContext
  ) {
    // Without scheduling this after render, this produces the "attempted to update value, but it had already been used previously in the same computation" type error
    schedule('afterRender', () => {
      this.renderedLinksToCards.push({
        element: linksToCardElement,
        card: linksToCard,
        stackedAtIndex: this.args.index,
        context,
      });
    });
  }

  unregisterLinkedCardElement(card: Card) {
    let index = this.renderedLinksToCards.findIndex(
      (renderedLinksToCard) => renderedLinksToCard.card === card
    );
    if (index !== -1) {
      this.renderedLinksToCards.splice(index, 1);
    }
  }

  @action toggleSelect(card: Card) {
    let index = this.selectedCards.findIndex((c) => c.id === card.id);

    if (index === -1) {
      this.selectedCards.push(card);
    } else {
      this.selectedCards.splice(index, 1);
    }
  }

  @action async copyToClipboard(cardUrl: string) {
    if (config.environment === 'test') {
      return; // navigator.clipboard is not available in test environment
    }

    await navigator.clipboard.writeText(cardUrl);
  }

  fetchRealmInfo = trackedFunction(this, async () => {
    let card = this.args.item.card;
    let realmInfo = await this.cardService.getRealmInfo(card);
    return realmInfo;
  });

  get iconURL() {
    return this.fetchRealmInfo.value?.iconURL ?? '/default-realm-icon.png';
  }

  get realmName() {
    return this.fetchRealmInfo.value?.name;
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
      : cardTypeDisplayName(this.args.item.card);
  }

  <template>
    <div
      class='item {{if this.isBuried "buried"}}'
      data-test-stack-card-index={{@index}}
      data-test-stack-card={{@item.card.id}}
      style={{this.styleForStackedCard}}
    >
      <CardContainer class={{cn 'card' edit=(eq @item.format 'edit')}}>
        <Header
          @icon={{this.headerIcon}}
          @title={{this.headerTitle}}
          class='header'
          {{on
            'click'
            (optional (if this.isBuried (fn @dismissStackedCardsAbove @index)))
          }}
          style={{cssVar
            boxel-header-icon-width='30px'
            boxel-header-icon-height='30px'
            boxel-header-text-size=(if this.isHoverOnRealmIcon 'var(--boxel-font)' 'var(--boxel-font-lg)')
            boxel-header-text-color=(if this.isHoverOnRealmIcon 'var(--boxel-teal)' 'var(--boxel-dark)')
            boxel-header-padding='var(--boxel-sp-xs)'
            boxel-header-action-padding='var(--boxel-sp-xs)'
          }}
          data-test-stack-card-header
        >
          <:actions>
            {{#if (eq @item.format 'isolated')}}
              <IconButton
                @icon='icon-pencil'
                @width='24px'
                @height='24px'
                @tooltip='Edit'
                class='icon-button'
                aria-label='Edit'
                {{on 'click' (fn @edit @item)}}
                data-test-edit-button
              />
            {{else}}
              <IconButton
                  @icon='icon-pencil'
                  @width='24px'
                  @height='24px'
                  @tooltip='Finish Editing'
                  class='icon-save'
                  aria-label='Finish Editing'
                  {{on 'click' (fn @save @item)}}
                  data-test-edit-button
                />
            {{/if}}
            <div>
              <BoxelDropdown>
                <:trigger as |bindings|>
                  <IconButton
                    @icon='icon-horizontal-three-dots'
                    @width='20px'
                    @height='20px'
                    @tooltip='More Options'
                    class='icon-button'
                    aria-label='Options'
                    data-test-more-options-button
                    {{bindings}}
                  />
                </:trigger>
                <:content as |dd|>
                  <BoxelMenu
                    @closeMenu={{dd.close}}
                    @items={{if
                      (eq @item.format 'edit')
                      (array
                        (menuItem
                          'Copy Card URL'
                          (fn this.copyToClipboard @item.card.id)
                          icon='icon-link'
                        )
                        (menuItem
                          'Delete' (fn @delete @item @index) icon='icon-trash'
                        )
                      )
                      (array
                        (menuItem
                          'Copy Card URL'
                          (fn this.copyToClipboard @item.card.id)
                          icon='icon-link'
                        )
                      )
                  }}
                />
                </:content>
              </BoxelDropdown>
            </div>
            <IconButton
              @icon='icon-x'
              @width='20px'
              @height='20px'
              @tooltip={{if (eq @item.format 'isolated') 'Close' 'Cancel & Close'}}
              class='icon-button'
              aria-label='Close'
              {{on 'click' (fn @close @item)}}
              data-test-close-button
            />
          </:actions>
        </Header>
        <div class='content'>
          <Preview
            @card={{@item.card}}
            @format={{@item.format}}
            @context={{this.context}}
          />
          <OperatorModeOverlays
            @renderedLinksToCards={{this.renderedLinksToCards}}
            @publicAPI={{@publicAPI}}
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

      .content > .boxel-card-container.boundaries {
        box-shadow: none;
      }

      .content > .boxel-card-container > header {
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
        margin-right: var(--boxel-sp-xxxs);
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
    </style>
  </template>
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    OperatorModeStackItem: typeof OperatorModeStackItem;
  }
}
