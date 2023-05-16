import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import {
  Card,
  CardRenderingContext,
  Format,
} from 'https://cardstack.com/base/card-api';
import Preview from './preview';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import CardCatalogModal from '@cardstack/host/components/card-catalog-modal';
import type CardService from '../services/card-service';
// import getValueFromWeakMap from '../helpers/get-value-from-weakmap';
import { eq, not } from '@cardstack/boxel-ui/helpers/truth-helpers';
import cn from '@cardstack/boxel-ui/helpers/cn';
import { IconButton, Modal } from '@cardstack/boxel-ui';
import SearchSheet, {
  SearchSheetMode,
} from '@cardstack/host/components/search-sheet';
import { restartableTask } from 'ember-concurrency';
import {
  Deferred,
  type Actions,
  type CardRef,
} from '@cardstack/runtime-common';
import type LoaderService from '../services/loader-service';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { TrackedArray } from 'tracked-built-ins';
import { cardTypeDisplayName } from '@cardstack/host/helpers/card-type-display-name';
import OperatorModeOverlays from '@cardstack/host/components/operator-mode-overlays';
import LinksToCardComponentModifier from '@cardstack/host/modifiers/links-to-card-component-modifier';
import { schedule } from '@ember/runloop';
import { htmlSafe } from '@ember/template';

interface Signature {
  Args: {
    firstCardInStack: Card;
    onClose: () => void;
  };
}

export type StackItem = {
  card: Card;
  format: Format;
  request?: Deferred<Card>;
};

export interface RenderedLinksToCard {
  element: HTMLElement;
  card: Card;
  context: CardRenderingContext;
  stackedAtIndex: number;
}

export default class OperatorMode extends Component<Signature> {
  stack: TrackedArray<StackItem>;
  //A variable to store value of card field
  //before in edit mode.
  cardFieldValues: WeakMap<Card, Map<string, any>> = new WeakMap<
    Card,
    Map<string, any>
  >();
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;
  @tracked searchSheetMode: SearchSheetMode = SearchSheetMode.Closed;

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.stack = new TrackedArray([
      {
        card: this.args.firstCardInStack,
        format: 'isolated',
      },
    ]);
  }

  @action onFocusSearchInput() {
    if (this.searchSheetMode == SearchSheetMode.Closed) {
      this.searchSheetMode = SearchSheetMode.SearchPrompt;
    }
  }

  @action onCancelSearchSheet() {
    this.searchSheetMode = SearchSheetMode.Closed;
  }

  @action addToStack(item: StackItem) {
    this.stack.push(item);
  }

  @action async edit(item: StackItem) {
    await this.saveCardFieldValues(item.card);
    this.setFormat(item, 'edit');
    this.stack = this.stack;
  }

  @action setFormat(item: StackItem, format: Format) {
    let index = this.stack.indexOf(item);
    if (index === -1) {
      throw new Error(`${item.card} was not found in stack`);
    }
    let newItem = {
      card: item.card,
      format,
    };
    this.stack[index] = newItem;
  }

  @action async close(item: StackItem) {
    await this.rollbackCardFieldValues(item.card);
    let index = this.stack.indexOf(item);
    this.stack.splice(index);
    if (this.stack.length === 0) {
      this.args.onClose();
    }
  }

  @action async cancel(item: StackItem) {
    if (item.request) {
      // clicking cancel closes the 'create new card' editor
      this.close(item);
    }
    await this.rollbackCardFieldValues(item.card);
    this.setFormat(item, 'isolated');
  }

  @action async save(item: StackItem) {
    let { card, request } = item;
    await this.saveCardFieldValues(card);
    let updatedCard = await this.write.perform(card);

    if (updatedCard && request) {
      request.fulfill(updatedCard);
      let index = this.stack.indexOf(item);
      this.stack[index] = {
        card: updatedCard,
        format: 'isolated',
      };
    }
  }

  private write = restartableTask(async (card: Card) => {
    return await this.cardService.saveModel(card);
  });

  private async saveCardFieldValues(card: Card) {
    let fields = await this.cardService.getFields(card);
    for (let fieldName of Object.keys(fields)) {
      if (fieldName === 'id') continue;

      let field = fields[fieldName];
      if (
        (field.fieldType === 'contains' ||
          field.fieldType === 'containsMany') &&
        !(await this.cardService.isPrimitive(field.card))
      ) {
        await this.saveCardFieldValues((card as any)[fieldName]);
      }

      let cardFieldValue = this.cardFieldValues.get(card);
      if (!cardFieldValue) {
        cardFieldValue = new Map<string, any>();
      }
      cardFieldValue.set(fieldName, (card as any)[fieldName]);
      this.cardFieldValues.set(card, cardFieldValue);
    }
  }

  private publicAPI: Actions = {
    createCard: async (
      ref: CardRef,
      relativeTo: URL | undefined
    ): Promise<Card | undefined> => {
      let doc = { data: { meta: { adoptsFrom: ref } } };
      let newCard = await this.cardService.createFromSerialized(
        doc.data,
        doc,
        relativeTo ?? this.cardService.defaultURL
      );

      let newItem: StackItem = {
        card: newCard,
        format: 'edit',
        request: new Deferred(),
      };
      this.addToStack(newItem);
      return await newItem.request?.promise;
    },
    // more CRUD ops to come...
  };

  private async rollbackCardFieldValues(card: Card) {
    let fields = await this.cardService.getFields(card);
    for (let fieldName of Object.keys(fields)) {
      if (fieldName === 'id') continue;

      let field = fields[fieldName];
      if (
        (field.fieldType === 'contains' ||
          field.fieldType === 'containsMany') &&
        !(await this.cardService.isPrimitive(field.card))
      ) {
        await this.rollbackCardFieldValues((card as any)[fieldName]);
      }

      let cardFieldValue = this.cardFieldValues.get(card);
      if (cardFieldValue) {
        (card as any)[fieldName] = cardFieldValue.get(fieldName);
      }
    }
  }

  get context() {
    return {
      renderedIn: this as Component<any>,
      cardComponentModifier: LinksToCardComponentModifier,
      optional: {
        stack: this.stack, // Not used currently, but eventually there will be more than one stack and we will need to know which one we are in.
      },
    };
  }

  @tracked renderedLinksToCards = new TrackedArray<RenderedLinksToCard>([]);
  registerLinkedCardElement(
    linksToCardElement: HTMLElement,
    linksToCard: Card,
    context: CardRenderingContext
  ) {
    // Without scheduling this after render, this produces the "attempted to update value, but it had already been used previously in the same computation" type error
    schedule('afterRender', () => {
      this.renderedLinksToCards.push({
        element: linksToCardElement,
        card: linksToCard,
        stackedAtIndex: this.stack.length,
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

  styleForStackedCard(stack: StackItem[], index: number) {
    let invertedIndex = stack.length - index - 1;

    let widthReductionPercent = 5; // Every new card on the stack is 5% wider than the previous one
    let offsetPx = 65; // Every new card on the stack is 65px lower than the previous one

    return htmlSafe(`
      width: ${100 - invertedIndex * widthReductionPercent}%;
      z-index: ${stack.length - invertedIndex};
      margin-top: calc(${offsetPx}px * ${index + 1});
      `);
  }

  <template>
    <Modal
      class='operator-mode'
      @isOpen={{true}}
      @onClose={{@onClose}}
      @isOverlayDismissalDisabled={{true}}
      @boxelModalOverlayColor='var(--operator-mode-bg-color)'
    >

      <CardCatalogModal />

      <div class='operator-mode-card-stack'>
        <OperatorModeOverlays
          @renderedLinksToCards={{this.renderedLinksToCards}}
          @addToStack={{this.addToStack}}
        />

        {{#each this.stack as |item i|}}
          <div
            class='operator-mode-card-stack__card'
            data-test-stack-card-index={{i}}
            data-test-stack-card={{item.card.id}}
            style={{this.styleForStackedCard this.stack i}}
          >
            <div
              class={{cn
                'operator-mode-card-stack__card__item'
                operator-mode-card-stack__card__item_edit=(eq
                  item.format 'edit'
                )
              }}
            >
              <Preview
                @card={{item.card}}
                @format={{item.format}}
                @actions={{this.publicAPI}}
                @context={{this.context}}
              />
            </div>
            <div class='operator-mode-card-stack__card__header'>
              <div
                class='operator-mode-card-stack__card__header__type'
                data-type-display-name
              >{{cardTypeDisplayName item.card}}</div>
              {{#if (not (eq item.format 'edit'))}}
                <IconButton
                  @icon='icon-horizontal-three-dots'
                  @width='20px'
                  @height='20px'
                  class='icon-button'
                  aria-label='Edit'
                  {{on 'click' (fn this.edit item i)}}
                  data-test-edit-button
                />
              {{/if}}
              <IconButton
                @icon='icon-x'
                @width='20px'
                @height='20px'
                class='icon-button'
                aria-label='Close'
                {{on 'click' (fn this.close item)}}
                data-test-close-button
              />
            </div>
            {{#if (eq item.format 'edit')}}
              <div class='operator-mode-card-stack__card__footer'>
                <button
                  class='operator-mode-card-stack__card__footer-button light-button'
                  {{on 'click' (fn this.cancel item)}}
                  aria-label='Cancel'
                  data-test-cancel-button
                >
                  Cancel
                </button>
                <button
                  class='operator-mode-card-stack__card__footer-button'
                  {{on 'click' (fn this.save item)}}
                  aria-label='Save'
                  data-test-save-button
                >
                  Save
                </button>
              </div>
            {{/if}}
          </div>
        {{/each}}
      </div>
      <SearchSheet
        @mode={{this.searchSheetMode}}
        @onCancel={{this.onCancelSearchSheet}}
        @onFocus={{this.onFocusSearchInput}}
      />
    </Modal>
  </template>
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    OperatorMode: typeof OperatorMode;
  }
}
