import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { Card, CardContext, Format } from 'https://cardstack.com/base/card-api';
import Preview from './preview';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import CardCatalogModal from '@cardstack/host/components/card-catalog-modal';
import type CardService from '../services/card-service';
// import getValueFromWeakMap from '../helpers/get-value-from-weakmap';
import { eq, not } from '@cardstack/boxel-ui/helpers/truth-helpers';
import optional from '@cardstack/boxel-ui/helpers/optional';
import cn from '@cardstack/boxel-ui/helpers/cn';
import {
  IconButton,
  Modal,
  Header,
  CardContainer,
  Button,
} from '@cardstack/boxel-ui';
import SearchSheet, {
  SearchSheetMode,
} from '@cardstack/host/components/search-sheet';
import { restartableTask } from 'ember-concurrency';
import {
  Deferred,
  baseCardRef,
  chooseCard,
  type Actions,
  type CardRef,
  cardTypeDisplayName,
} from '@cardstack/runtime-common';
import type LoaderService from '../services/loader-service';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { TrackedArray } from 'tracked-built-ins';
import OperatorModeOverlays from '@cardstack/host/components/operator-mode-overlays';
import LinksToCardComponentModifier from '@cardstack/host/modifiers/links-to-card-component-modifier';
import { schedule } from '@ember/runloop';
import { htmlSafe } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import type { Query } from '@cardstack/runtime-common/query';
import { getSearchResults, type Search } from '../resources/search';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import perform from 'ember-concurrency/helpers/perform';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

interface Signature {
  Args: {
    onClose: () => void;
  };
}

export type OperatorModeState = {
  stacks: Stack[];
};

export type Stack = {
  items: StackItem[];
};

export type StackItem = {
  card: Card;
  format: Format;
  request?: Deferred<Card>;
  isLinkedCard?: boolean;
};

export interface RenderedLinksToCard {
  element: HTMLElement;
  card: Card;
  context: CardContext;
  stackedAtIndex: number;
}

export default class OperatorMode extends Component<Signature> {
  //A variable to store value of card field
  //before in edit mode.
  cardFieldValues: WeakMap<Card, Map<string, any>> = new WeakMap<
    Card,
    Map<string, any>
  >();
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;
  @service declare operatorModeStateService: OperatorModeStateService;
  @tracked searchSheetMode: SearchSheetMode = SearchSheetMode.Closed;

  constructor(owner: unknown, args: any) {
    super(owner, args);

    (globalThis as any)._CARDSTACK_CARD_SEARCH = this;
    registerDestructor(this, () => {
      delete (globalThis as any)._CARDSTACK_CARD_SEARCH;
      this.operatorModeStateService.clearStack();
    });
  }

  get stack() {
    // We return the first one until we start supporting 2 stacks
    return this.operatorModeStateService.state?.stacks[0]?.items;
  }

  @action
  getCards(query: Query): Search {
    return getSearchResults(this, () => query);
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
    this.operatorModeStateService.addItemToStack(item);
  }

  @action async edit(item: StackItem) {
    await this.saveCardFieldValues(item.card);
    this.updateItem(item, 'edit', new Deferred());
  }

  @action updateItem(
    item: StackItem,
    format: Format,
    request?: Deferred<Card>
  ) {
    let newItem = {
      card: item.card,
      format,
      request,
    };

    this.replaceItemInStack(item, newItem);

    return newItem;
  }

  @action async close(item: StackItem) {
    await this.rollbackCardFieldValues(item.card);

    this.operatorModeStateService.removeItemFromStack(item);
  }

  @action async cancel(item: StackItem) {
    await this.rollbackCardFieldValues(item.card);
    this.updateItem(item, 'isolated');
  }

  @action async save(item: StackItem) {
    let { card, request, isLinkedCard } = item;
    await this.saveCardFieldValues(card);
    let updatedCard = await this.write.perform(card);

    if (updatedCard) {
      request?.fulfill(updatedCard);

      if (isLinkedCard) {
        this.close(item); // closes the 'create new card' editor for linked card fields
      } else {
        this.replaceItemInStack(item, {
          card: updatedCard,
          format: 'isolated',
        });
      }
    }
  }

  replaceItemInStack(item: StackItem, newItem: StackItem) {
    this.operatorModeStateService.replaceItemInStack(item, newItem);
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
      relativeTo: URL | undefined,
      opts?: {
        isLinkedCard?: boolean;
      }
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
        isLinkedCard: opts?.isLinkedCard,
      };
      this.addToStack(newItem);
      return await newItem.request?.promise;
    },
    viewCard: (card: Card) => {
      return this.addToStack({ card, format: 'isolated' });
    },
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
      actions: this.publicAPI,
    };
  }

  @tracked renderedLinksToCards = new TrackedArray<RenderedLinksToCard>([]);
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
    let offsetPx = 40; // Every new card on the stack is 40px lower than the previous one

    return htmlSafe(`
      width: ${100 - invertedIndex * widthReductionPercent}%;
      z-index: ${stack.length - invertedIndex};
      padding-top: calc(${offsetPx}px * ${index});
    `);
  }

  addCard = restartableTask(async () => {
    let type = baseCardRef;
    let chosenCard: Card | undefined = await chooseCard({
      filter: { type },
    });

    if (chosenCard) {
      let newItem: StackItem = {
        card: chosenCard,
        format: 'isolated',
      };
      this.addToStack(newItem);
    }
  });

  @action
  isBuried(stackIndex: number) {
    return stackIndex + 1 < this.stack.length;
  }

  @action
  async dismissStackedCardsAbove(stackIndex: number) {
    for (let i = this.stack.length - 1; i > stackIndex; i--) {
      let stackItem = this.stack[i];
      await this.close(stackItem);
    }
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

      {{#if (eq this.stack.length 0)}}
        <div class='operator-mode__no-cards'>
          <p class='operator-mode__no-cards__add-card-title'>Add a card to get
            started</p>
          {{! Cannot find an svg icon with plus in the box
          that we can fill the color of the plus and the box. }}
          <button
            class='operator-mode__no-cards__add-card-button icon-button'
            {{on 'click' (fn (perform this.addCard))}}
            data-test-add-card-button
          >
            {{svgJar 'icon-plus' width='50px' height='50px'}}
          </button>
        </div>
      {{else}}
        <div class='operator-mode-card-stack'>
          {{! z-index and offset calculation in the OperatorModeOverlays operates under assumption that it is nested under element with class operator-mode-card-stack }}
          <OperatorModeOverlays
            @renderedLinksToCards={{this.renderedLinksToCards}}
            @addToStack={{this.addToStack}}
          />

          {{#each this.stack as |item i|}}
            <div
              class={{cn
                'operator-mode-card-stack__item'
                operator-mode-card-stack__buried=(this.isBuried i)
              }}
              data-test-stack-card-index={{i}}
              data-test-stack-card={{item.card.id}}
              style={{this.styleForStackedCard this.stack i}}
            >
              <CardContainer
                class={{cn
                  'operator-mode-card-stack__card'
                  operator-mode-card-stack__card--edit=(eq item.format 'edit')
                }}
              >
                <Header
                  @title={{cardTypeDisplayName item.card}}
                  class='operator-mode-card-stack__card__header'
                  {{on
                    'click'
                    (optional
                      (if
                        (this.isBuried i) (fn this.dismissStackedCardsAbove i)
                      )
                    )
                  }}
                >
                  <:actions>
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
                  </:actions>
                </Header>
                <div class='operator-mode-card-stack__card__content'>
                  <Preview
                    @card={{item.card}}
                    @format={{item.format}}
                    @context={{this.context}}
                  />
                </div>
                {{#if (eq item.format 'edit')}}
                  <footer class='operator-mode-card-stack__card__footer'>
                    <Button
                      @kind='secondary-light'
                      @size='tall'
                      class='operator-mode-card-stack__card__footer-button'
                      {{on 'click' (fn this.cancel item)}}
                      aria-label='Cancel'
                      data-test-cancel-button
                    >
                      Cancel
                    </Button>
                    <Button
                      @kind='primary'
                      @size='tall'
                      class='operator-mode-card-stack__card__footer-button'
                      {{on 'click' (fn this.save item)}}
                      aria-label='Save'
                      data-test-save-button
                    >
                      Save
                    </Button>
                  </footer>
                {{/if}}
              </CardContainer>
            </div>
          {{/each}}
        </div>
      {{/if}}
      <SearchSheet
        @mode={{this.searchSheetMode}}
        @onCancel={{this.onCancelSearchSheet}}
        @onFocus={{this.onFocusSearchInput}}
      />
    </Modal>
    <style>
      .operator-mode-card-stack__buried .operator-mode-card-stack__card {
        background-color: var(--boxel-200);
        grid-template-rows: 40px auto;
      }

      .operator-mode-card-stack__buried .operator-mode-card-stack__card__header .icon-button {
        display: none;
      }

      .operator-mode-card-stack__buried .operator-mode-card-stack__card__header {
        cursor: pointer;
        font: 500 var(--boxel-font-sm);
        padding: 0 var(--boxel-sp-xs);
      }
    </style>
  </template>
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    OperatorMode: typeof OperatorMode;
  }
}
